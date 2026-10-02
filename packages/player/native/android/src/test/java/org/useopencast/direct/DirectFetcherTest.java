package org.useopencast.direct;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.io.InputStream;
import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * A239, direct mode's native fetch (DirectFetcher) against local stand-in servers: no third-party
 * stream and no network beyond 127.0.0.1. The servers are local, so these fetchers allow private
 * addresses; the private-address rules are tested on their own, without fetching.
 */
public class DirectFetcherTest {

    private static final String UA = "Opencast TV (Android)";
    private MockWebServer source;
    private MockWebServer other;
    private CookieHandler before;

    @Before
    public void start() throws IOException {
        source = new MockWebServer();
        other = new MockWebServer();
        source.start();
        other.start();
        before = CookieHandler.getDefault();
    }

    @After
    public void stop() throws IOException {
        CookieHandler.setDefault(before);
        source.shutdown();
        other.shutdown();
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream s = in) {
            return new String(s.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    public void sendsNoOriginCookiesOrReferer_withTheAppsUserAgent() throws Exception {
        // As Capacitor does for its own HTTP plugin: a default CookieHandler holding a cookie for the source.
        CookieManager jar = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        HttpCookie cookie = new HttpCookie("session", "web-view-cookie");
        cookie.setPath("/");
        cookie.setVersion(0);
        jar.getCookieStore().add(URI.create(source.url("/").toString()), cookie);
        CookieHandler.setDefault(jar);
        source.enqueue(new MockResponse().setBody("#EXTM3U\n").addHeader("Content-Type", "application/vnd.apple.mpegurl").addHeader("Set-Cookie", "tracker=1"));

        DirectFetcher.Result r = new DirectFetcher(UA, true).fetch(source.url("/est/playlist.m3u8").toString(), null);
        assertEquals(200, r.status);
        assertEquals("#EXTM3U\n", read(r.body));
        assertEquals("application/vnd.apple.mpegurl", r.contentType);

        RecordedRequest req = source.takeRequest(5, TimeUnit.SECONDS);
        assertEquals("GET", req.getMethod());
        assertEquals(UA, req.getHeader("User-Agent"));
        assertEquals("*/*", req.getHeader("Accept"));
        assertNull(req.getHeader("Origin"));
        assertNull(req.getHeader("Cookie"));
        assertNull(req.getHeader("Referer"));
        assertNull(req.getHeader("Range"));
        // And nothing the source set is kept.
        assertTrue(jar.getCookieStore().getCookies().stream().noneMatch(c -> c.getName().equals("tracker")));
    }

    @Test
    public void followsRedirectsAcrossHostsAndPorts_andSaysWhereItEndedUp() throws Exception {
        String end = other.url("/live/chunklist.m3u8").toString();
        source.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", end));
        other.enqueue(new MockResponse().setBody("#EXTM3U\nmedia_1.ts\n"));

        DirectFetcher.Result r = new DirectFetcher(UA, true).fetch(source.url("/est/playlist.m3u8").toString(), null);
        assertEquals(200, r.status);
        assertEquals(end, r.finalUrl);
        assertEquals("#EXTM3U\nmedia_1.ts\n", read(r.body));
        assertNull(other.takeRequest(5, TimeUnit.SECONDS).getHeader("Referer"));
    }

    @Test
    public void followsARelativeRedirect() throws Exception {
        source.enqueue(new MockResponse().setResponseCode(301).addHeader("Location", "/moved/playlist.m3u8"));
        source.enqueue(new MockResponse().setBody("#EXTM3U\n"));
        DirectFetcher.Result r = new DirectFetcher(UA, true).fetch(source.url("/est/playlist.m3u8").toString(), null);
        assertEquals(source.url("/moved/playlist.m3u8").toString(), r.finalUrl);
        read(r.body);
    }

    @Test
    public void givesUpAfterFiveRedirects() throws Exception {
        for (int i = 0; i < 6; i++) source.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", "/again/" + i));
        try {
            new DirectFetcher(UA, true).fetch(source.url("/loop").toString(), null);
            fail("expected Refused");
        } catch (DirectFetcher.Refused e) {
            assertEquals(502, e.status);
        }
        assertEquals(6, source.getRequestCount());
    }

    @Test
    public void passesTheRangeAndTheSourcesPartialAnswer() throws Exception {
        source.enqueue(new MockResponse().setResponseCode(206).setBody("abcd").addHeader("Content-Range", "bytes 100-103/5000").addHeader("Accept-Ranges", "bytes"));
        DirectFetcher.Result r = new DirectFetcher(UA, true).fetch(source.url("/seg.ts").toString(), "bytes=100-103");
        assertEquals(206, r.status);
        assertEquals("bytes 100-103/5000", r.contentRange);
        assertEquals("bytes", r.acceptRanges);
        assertEquals(4, r.contentLength);
        assertEquals("abcd", read(r.body));
        assertEquals("bytes=100-103", source.takeRequest(5, TimeUnit.SECONDS).getHeader("Range"));
    }

    @Test
    public void passesTheSourcesErrorStatus() throws Exception {
        source.enqueue(new MockResponse().setResponseCode(500).setBody("<html>no</html>"));
        DirectFetcher.Result r = new DirectFetcher(UA, true).fetch(source.url("/est/playlist.m3u8").toString(), null);
        assertEquals(500, r.status);
        read(r.body);
    }

    @Test
    public void streamsALargeBodyThrough() throws Exception {
        byte[] big = new byte[4 * 1024 * 1024];
        for (int i = 0; i < big.length; i++) big[i] = (byte) i;
        source.enqueue(new MockResponse().setBody(new okio.Buffer().write(big)));
        DirectFetcher.Result r = new DirectFetcher(UA, true).fetch(source.url("/seg.ts").toString(), null);
        assertEquals(big.length, r.contentLength);
        byte[] got;
        try (InputStream in = r.body) {
            got = in.readAllBytes();
        }
        assertEquals(big.length, got.length);
        assertEquals(big[big.length - 1], got[got.length - 1]);
    }

    @Test
    public void refusesWhatIsntAnHttpAddress() {
        String[] bad = { "file:///etc/hosts", "ftp://x.example/a", "javascript:alert(1)", "", "http://user:pw@x.example/a.m3u8" };
        for (String a : bad) {
            try {
                DirectFetcher.checked(a, false);
                fail("expected Refused for " + a);
            } catch (DirectFetcher.Refused e) {
                assertEquals(400, e.status);
            }
        }
    }

    @Test
    public void refusesLocalAndPrivateAddressesOutsideDebug() throws Exception {
        String[] privateOnes = {
            "http://localhost/a.m3u8", "http://127.0.0.1:8080/a.m3u8", "http://10.1.2.3/a.m3u8", "http://172.16.0.9/a.m3u8", "http://192.168.1.1/a.m3u8",
            "http://169.254.169.254/latest", "http://[::1]/a.m3u8", "http://[fd00::1]/a.m3u8", "http://[fe80::1]/a.m3u8", "http://printer.local/a", "http://0.0.0.0/a", "http://100.64.0.1/a"
        };
        for (String a : privateOnes) {
            try {
                DirectFetcher.checked(a, false);
                fail("expected Refused for " + a);
            } catch (DirectFetcher.Refused e) {
                assertEquals(403, e.status);
            }
            // Debug builds (and these tests) may.
            DirectFetcher.checked(a, true);
        }
        DirectFetcher.checked("https://api.toonami.example/est/playlist.m3u8", false);
        DirectFetcher.checked("http://n3.toonami.example:1934/live/chunklist.m3u8", false);
        DirectFetcher.checked("http://8.8.8.8/a.m3u8", false);
        // And by what a name resolves to, without a connection.
        assertTrue(DirectFetcher.isPrivateAddress(InetAddress.getByName("192.168.0.10")));
        assertFalse(DirectFetcher.isPrivateAddress(InetAddress.getByName("93.184.216.34")));
        assertFalse(DirectFetcher.isPrivateAddress(InetAddress.getByName("2606:2800:220:1::1")));
    }

    @Test
    public void aPublicNameResolvingToAPrivateAddressIsRefused() {
        try {
            new DirectFetcher.PublicDns().lookup("localhost");
            fail("expected UnknownHostException");
        } catch (java.net.UnknownHostException e) {
            assertTrue(e.getMessage().contains("isn't a public address"));
        }
    }

    @Test
    public void theWebViewPathCarriesThisLaunchsToken() {
        String token = DirectStreams.newToken();
        assertEquals(32, token.length());
        assertNotEquals(token, DirectStreams.newToken());
        assertEquals(DirectStreams.Route.OURS, DirectStreams.routeOf("/_opencast/direct/" + token, token));
        assertEquals(DirectStreams.Route.WRONG_TOKEN, DirectStreams.routeOf("/_opencast/direct/guess", token));
        assertEquals(DirectStreams.Route.NOT_OURS, DirectStreams.routeOf("/v1/markets/inland-empire/dial", token));
        assertEquals(DirectStreams.Route.NOT_OURS, DirectStreams.routeOf("/index.html", token));
        assertEquals(DirectStreams.Route.NOT_OURS, DirectStreams.routeOf(null, token));
    }

    @Test
    public void readsHeadersAndCharsets() {
        Map<String, String> h = new HashMap<>();
        h.put("range", "bytes=0-9");
        assertEquals("bytes=0-9", DirectStreams.header(h, "Range"));
        assertNull(DirectStreams.header(h, "Origin"));
        assertEquals("utf-8", DirectStreams.charsetOf("application/vnd.apple.mpegurl; charset=utf-8"));
        assertNull(DirectStreams.charsetOf("video/mp2t"));
        assertEquals("Partial Content", DirectStreams.reasonFor(206));
    }
}
