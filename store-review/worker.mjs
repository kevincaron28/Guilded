import { reviewRequest } from './handler.mjs';
import kit from './review-kit.zip';
export class ReviewSession {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  fetch(request) { return reviewRequest(request, this.env, this.ctx.storage); }
}
export default {
  fetch(request, env) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/review-kit.zip') return new globalThis.Response(kit, {
      headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="Guilded-Store-Review.zip"', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
    });
    return env.REVIEW_SESSION.get(env.REVIEW_SESSION.idFromName('store-review')).fetch(request);
  }
};
