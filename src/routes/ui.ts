import { Hono } from 'hono';
import { dashboardHtml } from '../ui/html.ts';
import { dashboardCss } from '../ui/styles.ts';
import { dashboardScript } from '../ui/script.ts';

export function mountUiRoutes(app: Hono) {
  app.get('/', (c) => c.html(dashboardHtml, 200, {
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'",
    'x-content-type-options': 'nosniff',
  }));
  app.get('/assets/calliope.css', (c) => c.body(dashboardCss, 200, { 'content-type': 'text/css; charset=utf-8' }));
  app.get('/assets/calliope.js', (c) => c.body(dashboardScript, 200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
  }));
}
