/** SSE transport: stop pulling the provider iterator while the socket is backpressured. */
import type { ServerResponse } from "node:http";

function drainOrClose(res: ServerResponse): Promise<void> {
  if (res.destroyed || res.writableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      res.off("error", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
    res.once("error", done);
  });
}

/** Stream events and close the source on disconnection, without reading ahead of a slow consumer. */
export async function streamSse(
  res: ServerResponse,
  source: AsyncIterable<unknown>,
  map: (item: unknown) => unknown,
  errorBody: (error: unknown) => unknown,
): Promise<void> {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const iterator = source[Symbol.asyncIterator]();
  let gone = res.destroyed;
  let returned = false;
  const release = (): void => {
    if (returned) return;
    returned = true;
    void Promise.resolve().then(() => iterator.return?.(undefined)).catch(() => undefined);
  };
  const disconnected = (): void => { gone = true; release(); };
  res.on("close", disconnected);
  res.on("error", disconnected);
  try {
    while (!gone) {
      const step = await iterator.next();
      if (step.done || gone) break;
      if (!res.write(`data: ${JSON.stringify(map(step.value))}\n\n`)) await drainOrClose(res);
    }
    if (!gone) res.write("event: end\ndata: {}\n\n");
  } catch (error) {
    if (!gone) res.write(`event: error\ndata: ${JSON.stringify(errorBody(error))}\n\n`);
  } finally {
    release();
    if (!gone) res.end();
    res.off("close", disconnected);
    res.off("error", disconnected);
  }
}
