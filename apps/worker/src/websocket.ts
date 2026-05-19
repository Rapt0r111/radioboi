export function closeWebSocketSafely(
  ws: Pick<WebSocket, "close">,
  code?: number,
  reason?: string,
): void {
  try {
    ws.close(code, reason);
  } catch {
    // workerd may invoke close handlers after the socket has already closed.
  }
}
