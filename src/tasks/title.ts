/**
 * タスクタイトルの正規化 (突合キー生成)。
 * 棚卸し (§G3 重複候補) と自動生成 (§G2 dedup) が同じ規則を共有するための単一実装。
 * 小文字化 + NFKC + 記号/空白畳み込み。
 *
 * @spec dedup と再提案抑止
 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
