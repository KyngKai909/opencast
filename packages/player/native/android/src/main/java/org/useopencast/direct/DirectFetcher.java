package org.useopencast.direct;

import java.io.IOException;
import java.io.InputStream;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import okhttp3.CookieJar;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * A239, direct mode (the user's decision): an external station's stream fetched with the device's
 * own networking, as VLC does. Plain Java and OkHttp, so it runs in a JVM unit test.
 *
 * <ul>
 *   <li>No {@code Origin}, no cookies (OkHttp's {@code NO_COOKIES}, whatever CookieHandler
 *       Capacitor installs for its own HTTP plugin), no {@code Referer}; a VLC-like user agent and
 *       {@code Accept} of anything; the player's {@code Range} when it asks for one.
 *   <li>http and https, with redirects followed here (up to 5, across schemes, hosts and ports),
 *       each address checked the same way. Cleartext needs the app's network security config to
 *       allow it (res/xml/network_security_config.xml).
 *   <li>Only http(s), never an address with a user name or password, and (outside debug builds) never
 *       a local or private address, by name or by what it resolves to: a page in the web view can't
 *       use this to reach the viewer's own network.
 * </ul>
 */
public final class DirectFetcher {

    public static final int MAX_REDIRECTS = 5;

    /** The answer: the source's status, where it finally came from, and its body to stream through. */
    public static final class Result {
        public final int status;
        public final String reason;
        public final String finalUrl;
        public final String contentType;
        public final long contentLength;
        public final String contentRange;
        public final String acceptRanges;
        public final String age;
        public final InputStream body;

        Result(Response res, String finalUrl) {
            ResponseBody b = res.body();
            this.status = res.code();
            this.reason = res.message();
            this.finalUrl = finalUrl;
            this.contentType = res.header("Content-Type");
            // -1 when OkHttp decompressed it (it then drops the length) or the source didn't say.
            this.contentLength = b == null ? -1 : b.contentLength();
            this.contentRange = res.header("Content-Range");
            this.acceptRanges = res.header("Accept-Ranges");
            this.age = res.header("Age");
            this.body = b == null ? new java.io.ByteArrayInputStream(new byte[0]) : b.byteStream();
        }
    }

    /** Refused before anything was fetched (or a redirect that can't be followed): the status to answer with. */
    public static final class Refused extends IOException {
        public final int status;

        public Refused(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private final OkHttpClient client;
    private final String userAgent;
    private final boolean allowPrivate;

    /**
     * @param userAgent sent with every request ("Opencast TV (Android)", "Opencast (Android)").
     * @param allowPrivate local and private addresses too (debug builds and tests only).
     */
    public DirectFetcher(String userAgent, boolean allowPrivate) {
        this.userAgent = userAgent;
        this.allowPrivate = allowPrivate;
        this.client = new OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .cookieJar(CookieJar.NO_COOKIES)
            .dns(allowPrivate ? Dns.SYSTEM : new PublicDns())
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build();
    }

    /**
     * Fetches an address (following its redirects). The caller streams {@code body} through and
     * closes it. Throws {@link Refused} for an address that mustn't be fetched, IOException when the
     * source can't be reached.
     */
    public Result fetch(String address, String range) throws IOException {
        String at = address;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpUrl url = checked(at, allowPrivate);
            Request.Builder req = new Request.Builder().url(url).get().header("User-Agent", userAgent).header("Accept", "*/*");
            if (range != null && !range.isEmpty()) req.header("Range", range);
            Response res = client.newCall(req.build()).execute();
            if (!res.isRedirect()) {
                if (res.code() >= 300 && res.code() < 400) {
                    // 304 and friends: nothing a player can use (no conditional request was sent).
                    res.close();
                    throw new Refused(502, "The source answered " + res.code());
                }
                return new Result(res, url.toString());
            }
            String location = res.header("Location");
            res.close();
            HttpUrl next = location == null ? null : url.resolve(location);
            if (next == null) throw new Refused(502, "A redirect without a usable address");
            at = next.toString();
        }
        throw new Refused(502, "Too many redirects");
    }

    /** The address as OkHttp's, if it may be fetched: http(s), no user info, and (unless allowed) not local or private by its name or literal address. */
    public static HttpUrl checked(String address, boolean allowPrivate) throws Refused {
        if (address == null || address.isEmpty()) throw new Refused(400, "No address");
        String lower = address.trim().toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) throw new Refused(400, "Only http and https addresses");
        HttpUrl url = HttpUrl.parse(address.trim());
        if (url == null) throw new Refused(400, "Not an address");
        if (!url.username().isEmpty() || !url.password().isEmpty()) throw new Refused(400, "No user names or passwords in addresses");
        if (!allowPrivate && isPrivateName(url.host())) throw new Refused(403, "Not a public address");
        return url;
    }

    /** localhost, *.localhost, *.local, and literal addresses in local or private ranges. */
    public static boolean isPrivateName(String host) {
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[") && h.endsWith("]")) h = h.substring(1, h.length() - 1);
        if (h.equals("localhost") || h.endsWith(".localhost") || h.endsWith(".local")) return true;
        InetAddress literal = literalAddress(h);
        return literal != null && isPrivateAddress(literal);
    }

    /** Loopback, unspecified, link-local, 10/8, 172.16/12, 192.168/16, 100.64/10, multicast, IPv6 unique-local. */
    public static boolean isPrivateAddress(InetAddress a) {
        if (a.isLoopbackAddress() || a.isAnyLocalAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress() || a.isMulticastAddress()) return true;
        byte[] b = a.getAddress();
        if (a instanceof Inet6Address) return (b[0] & 0xfe) == 0xfc;
        // Carrier-grade NAT (100.64.0.0/10) and 0.0.0.0/8.
        int first = b[0] & 0xff;
        int second = b[1] & 0xff;
        return first == 0 || (first == 100 && second >= 64 && second < 128);
    }

    /** A literal IPv4 or IPv6 address, parsed without a DNS lookup; null for a name. */
    static InetAddress literalAddress(String host) {
        boolean v4 = host.matches("\\d{1,3}(\\.\\d{1,3}){3}");
        boolean v6 = host.contains(":") && host.matches("[0-9a-f:.]+");
        if (!v4 && !v6) return null;
        try {
            return InetAddress.getByName(host);
        } catch (UnknownHostException e) {
            return null;
        }
    }

    /** DNS that never hands back a local or private address (a public name pointed at the viewer's network). */
    static final class PublicDns implements Dns {

        @Override
        public List<InetAddress> lookup(String hostname) throws UnknownHostException {
            List<InetAddress> all = Dns.SYSTEM.lookup(hostname);
            List<InetAddress> ok = new ArrayList<>();
            for (InetAddress a : all) if (!isPrivateAddress(a)) ok.add(a);
            if (ok.isEmpty()) throw new UnknownHostException(hostname + " isn't a public address");
            return ok;
        }
    }
}
