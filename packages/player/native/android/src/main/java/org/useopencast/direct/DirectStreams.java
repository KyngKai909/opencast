package org.useopencast.direct;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * A239, direct mode: the web view's side. The player (packages/player, direct.ts) asks for
 * {@code /_opencast/direct/<token>?u=<address>} on the app's own origin; {@link #intercept} answers it
 * from {@code shouldInterceptRequest} by fetching the address natively ({@link DirectFetcher}) and
 * streaming the body straight through: no base64 over the Capacitor bridge, nothing buffered whole.
 * The address it finally came from (after redirects) is in {@code X-Opencast-Url}, so hls.js resolves
 * a playlist's relative addresses there.
 *
 * <p>The token is random per launch and handed out only through the OpencastDirect plugin, which
 * only the app's own page can call (Capacitor's bridge isn't given to other origins), so a page in a
 * frame (an official embed) can't use this path. Everything else the web view loads, the API's calls
 * included, never comes here.
 */
public final class DirectStreams {

    /** Where the path starts; the token follows. */
    public static final String PATH = "/_opencast/direct/";
    /** The final address, after redirects (direct.ts's DIRECT_URL_HEADER). */
    public static final String URL_HEADER = "X-Opencast-Url";

    /** Something the app's activity gives its plugin and web view client. */
    public interface Host {
        DirectStreams directStreams();
    }

    /** What a request's path is to direct mode. */
    public enum Route {
        NOT_OURS,
        OURS,
        WRONG_TOKEN
    }

    private final String token;
    private final DirectFetcher fetcher;
    private final String userAgent;

    public DirectStreams(String userAgent, boolean allowPrivate) {
        this(userAgent, new DirectFetcher(userAgent, allowPrivate), newToken());
    }

    DirectStreams(String userAgent, DirectFetcher fetcher, String token) {
        this.userAgent = userAgent;
        this.fetcher = fetcher;
        this.token = token;
    }

    static String newToken() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }

    /** The path the page fetches through (the plugin hands it out). */
    public String basePath() {
        return PATH + token;
    }

    public String userAgent() {
        return userAgent;
    }

    /** Whether a path is direct mode's, with this launch's token. */
    public static Route routeOf(String path, String token) {
        if (path == null || !path.startsWith(PATH)) return Route.NOT_OURS;
        return path.equals(PATH + token) ? Route.OURS : Route.WRONG_TOKEN;
    }

    /** The answer for one of direct mode's requests, or null for any other request (the web view's usual handling). */
    public WebResourceResponse intercept(WebResourceRequest request) {
        Uri uri = request.getUrl();
        Route route = routeOf(uri.getPath(), token);
        if (route == Route.NOT_OURS) return null;
        if (route == Route.WRONG_TOKEN) return error(403, "Forbidden");
        if (!"GET".equalsIgnoreCase(request.getMethod())) return error(405, "Method Not Allowed");
        String address = uri.getQueryParameter("u");
        String range = header(request.getRequestHeaders(), "Range");
        try {
            DirectFetcher.Result r = fetcher.fetch(address, range);
            return answer(r);
        } catch (DirectFetcher.Refused e) {
            return error(e.status, e.status == 403 ? "Forbidden" : e.status == 400 ? "Bad Request" : "Bad Gateway");
        } catch (IOException e) {
            return error(502, "Bad Gateway");
        }
    }

    private static WebResourceResponse answer(DirectFetcher.Result r) {
        String type = r.contentType == null ? "application/octet-stream" : r.contentType;
        String mime = type.split(";", 2)[0].trim();
        String charset = charsetOf(type);
        // (The web view writes Content-Type itself, from the MIME type and charset.)
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put(URL_HEADER, r.finalUrl);
        if (r.contentLength >= 0) headers.put("Content-Length", String.valueOf(r.contentLength));
        if (r.contentRange != null) headers.put("Content-Range", r.contentRange);
        if (r.acceptRanges != null) headers.put("Accept-Ranges", r.acceptRanges);
        if (r.age != null) headers.put("Age", r.age);
        // The web view takes 1xx, 2xx, 4xx and 5xx only (redirects were followed already).
        int status = r.status >= 300 && r.status < 400 ? 502 : r.status;
        String reason = r.reason == null || r.reason.trim().isEmpty() ? reasonFor(status) : r.reason;
        return new WebResourceResponse(mime, charset, status, reason, headers, r.body);
    }

    private static WebResourceResponse error(int status, String reason) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", status, reason, headers, new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    static String reasonFor(int status) {
        if (status == 200) return "OK";
        if (status == 206) return "Partial Content";
        if (status == 404) return "Not Found";
        if (status >= 500) return "Server Error";
        if (status >= 400) return "Client Error";
        return "OK";
    }

    static String charsetOf(String contentType) {
        for (String part : contentType.split(";")) {
            String p = part.trim();
            if (p.toLowerCase(Locale.ROOT).startsWith("charset=")) return p.substring(8).replace("\"", "").trim();
        }
        return null;
    }

    static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> e : headers.entrySet()) if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue();
        return null;
    }
}
