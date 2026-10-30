package dev.guia.observer;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Base64;
import java.util.function.Predicate;

/**
 * Disposable Fabric QA-only read-only presence query. A fresh nonce is signed
 * by the running JVM; a stale JOIN log cannot answer after the JVM exits.
 * Not a production transport, nor player credential verification.
 */
final class GuiaLiveSessionQuery implements AutoCloseable {
    private static final int QA_PORT = 25594;
    private final ServerSocket listener;
    private final Thread worker;
    private final PrivateKey signer;
    private final String worldId;
    private final Predicate<String> isConnected;
    private volatile boolean running = true;

    GuiaLiveSessionQuery(String worldId, PrivateKey signer, Predicate<String> isConnected)
            throws IOException {
        this.worldId = worldId;
        this.signer = signer;
        this.isConnected = isConnected;
        listener = new ServerSocket();
        // No wildcard bind, no administrative port, no unauthenticated commands.
        listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), QA_PORT), 4);
        listener.setSoTimeout(700);
        worker = new Thread(this::serve, "guiaia-qa-live-presence");
        worker.setDaemon(true);
        worker.start();
    }

    private void serve() {
        while (running) {
            try (Socket socket = listener.accept()) {
                socket.setSoTimeout(750);
                socket.setTcpNoDelay(true);
                // Bounded ASCII request: "UUID hex-nonce\n"; reject slow/oversize clients.
                byte[] request = new byte[128];
                int length = 0, value = -1;
                while (length < request.length && (value = socket.getInputStream().read()) >= 0) {
                    if (value == '\n') break;
                    if (value < 0x20 || value > 0x7e) { length = request.length; break; }
                    request[length++] = (byte) value;
                }
                if (length >= request.length || value != '\n') continue;
                String[] fields = new String(request, 0, length, StandardCharsets.US_ASCII)
                        .split(" ", -1);
                if (fields.length != 2 ||
                        !fields[0].matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}") ||
                        !fields[1].matches("[a-f0-9]{32}")) continue;
                long now = System.currentTimeMillis();
                boolean connected = isConnected.test(fields[0]);
                // JSON order is deliberately identical to Node JSON.stringify().
                String payload = "{\"aud\":\"guiaia:live-presence:v1\","
                        + "\"worldId\":\"" + worldId + "\","
                        + "\"connectionId\":\"" + fields[0] + "\","
                        + "\"nonce\":\"" + fields[1] + "\","
                        + "\"connected\":" + connected + ","
                        + "\"issuedAt\":" + now + ","
                        + "\"expiresAt\":" + (now + 3000) + "}";
                Signature signature = Signature.getInstance("Ed25519");
                signature.initSign(signer);
                signature.update(payload.getBytes(StandardCharsets.UTF_8));
                String sig = Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign());
                byte[] result = ("{\"payload\":" + payload + ",\"signature\":\"" + sig + "\"}\n")
                        .getBytes(StandardCharsets.UTF_8);
                socket.getOutputStream().write(result);
                socket.getOutputStream().flush();
            } catch (java.net.SocketTimeoutException e) {
                // No active connection; retry without creating any player state.
            } catch (Exception e) {
                if (running) {
                    // No player names, credentials or keys in logs.
                }
            }
        }
    }

    @Override
    public void close() {
        running = false;
        try { listener.close(); } catch (IOException ignored) {}
        worker.interrupt();
    }
}
