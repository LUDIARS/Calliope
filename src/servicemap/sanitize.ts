// 匿名公開ビュー向けのサニタイズ (純粋ロジック)。
// spec/data-schema.md: ポートは CF 認証済み full API のみで返す。構造化フィールドを
// 落とすだけでは足りず、自由記述に紛れ込んだ内部エンドポイント表記も伏せる
// (Villa 由来の description は "port: 3000" 形式を持つ — engine の移行パーサ参照)。

/** "port: 3000" / "ポート 3000" のようなラベル付き表記 (export/support 等の語中は除く)。 */
const LABELLED_PORT = /(?<![A-Za-z])(port|ポート)(\s*[:：]?\s*)\d{2,5}(?![\d])/gi;
/** "http://127.0.0.1:3000" のような URL 内のポート (":" 単体は時刻等と紛れるため // 必須)。 */
const URL_PORT = /(\/\/[^\s/]+):\d{2,5}(?![\d])/g;

/** 説明文からポート表記を伏せる。ポート以外の記述はそのまま残す。 */
export function redactEndpoints(description: string): string {
  return description
    .replace(LABELLED_PORT, '$1$2***')
    .replace(URL_PORT, '$1:***');
}
