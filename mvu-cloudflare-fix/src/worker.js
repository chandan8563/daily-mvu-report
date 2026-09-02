import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
globalThis.CLOUDFLARE_WORKER = true;
const appModule = await import('./index.js');
const { app, setRuntimeEnv } = appModule.default || appModule;
setRuntimeEnv(env);
app.listen(3000);
const expressHandler = httpServerHandler({ port: 3000 });

export default {
  async fetch(request, workerEnv, ctx) {
    setRuntimeEnv(workerEnv);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return workerEnv.ASSETS.fetch(request);
    }
    return expressHandler(request, workerEnv, ctx);
  }
};
