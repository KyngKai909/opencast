package org.useopencast.direct;

import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * A239: Capacitor's web view client with direct mode's path in front of it. Only
 * {@code /_opencast/direct/<token>} is answered here (DirectStreams); every other request, the
 * app's own files and the API's calls included, goes to Capacitor exactly as before.
 */
public final class DirectWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;
    private final DirectStreams streams;

    public DirectWebViewClient(Bridge bridge, DirectStreams streams) {
        super(bridge);
        this.bridge = bridge;
        this.streams = streams;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse direct = streams.intercept(request);
        return direct != null ? direct : super.shouldInterceptRequest(view, request);
    }

    /**
     * Puts direct mode in front of the bridge: its web view client, and (where Capacitor resolves
     * service workers' requests, as in dev:mock with its mock service worker) the service worker client.
     */
    public static void install(Bridge bridge, DirectStreams streams) {
        if (bridge == null) return;
        bridge.setWebViewClient(new DirectWebViewClient(bridge, streams));
        if (bridge.getConfig().isResolveServiceWorkerRequests()) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(
                new ServiceWorkerClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        WebResourceResponse direct = streams.intercept(request);
                        return direct != null ? direct : bridge.getLocalServer().shouldInterceptRequest(request);
                    }
                }
            );
        }
    }
}
