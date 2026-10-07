/**
 * monday.com GraphQL client for the document hand-over board — ported from DELIPAS (lib/monday.ts).
 * The board stays the source of truth: tickets are created and assigned in monday; this module lists
 * them, collects a signature, uploads it as evidence and sets the outcome.
 */
import { DomainError } from '../../common/errors';

export const COLUMNS = {
  status: 'single_select_1',
  files: 'signature',
  date: 'date',
  customer: 'dropdown',
} as const;

/** Status label index → label, checked against the board before every save. */
export const OUTCOMES = {
  '1': 'ได้รับเอกสารครบถ้วน/ส่งมอบเอกสารแล้ว',
  '0': 'รับเอกสารไม่ครบถ้วน',
  '2': 'ไม่ได้รับเอกสาร/ไม่ได้ส่งมอบเอกสาร',
} as const;
export type Outcome = keyof typeof OUTCOMES;

/** Board groups shown as tabs. `future`: dated items after today are listed too (New request only). */
export const GROUPS = [
  { key: 'today', id: 'new_group__1', title: 'รายละเอียดงานวันนี้', future: false },
  { key: 'new', id: 'new_group84571__1', title: 'New request', future: true },
  { key: 'pending', id: 'topics', title: 'รอดำเนินการ', future: false },
  { key: 'done2569', id: 'group_mkz9kzvs', title: 'ดำเนินการเสร็จ2569', future: false },
] as const;
export const GROUP_LIMIT = 30;

const DETAIL_COLUMNS = [
  'dropdown', 'text0', 'short_text308', 'short_text', 'single_select5', 'date', 'single_select1', COLUMNS.status, 'item_id', 'dropdown1', 'short_text7', COLUMNS.files,
  'short_text1', 'short_text3', 'short_text2', 'short_text0', 'short_text71', 'short_text8', 'short_text85', 'short_text89', 'short_text852', 'short_text00', 'short_text4', 'short_text20',
  'short_text25', 'short_text259', 'short_text36', 'short_text30',
];
const LIST_COLUMNS = ['dropdown', 'text0', 'date', 'single_select1', 'single_select5', COLUMNS.status];
const detailFields = `id name updated_at board{id} parent_item{id} group{id title} column_values(ids:${JSON.stringify(DETAIL_COLUMNS)}) {id text value}`;
const listFields = `id name updated_at board{id} parent_item{id} column_values(ids:${JSON.stringify(LIST_COLUMNS)}) {id text value}`;

/** Document lines on a ticket: [title, detail column, quantity column]. */
const DOCUMENT_PAIRS: [string, string, string][] = [
  ['ใบกำกับภาษี', 'short_text1', 'short_text3'],
  ['ใบเสร็จรับเงิน', 'short_text2', 'short_text0'],
  ['ใบสำคัญรับเงิน', 'short_text71', 'short_text8'],
  ['ใบสำคัญจ่าย', 'short_text85', 'short_text89'],
  ['เช็ค', 'short_text852', 'short_text00'],
  ['แบบนำส่งประกันสังคม', 'short_text4', 'short_text20'],
  ['Bank Statement', 'short_text25', 'short_text259'],
  ['เอกสารอื่นๆ', 'short_text36', 'short_text30'],
];

export interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}
export interface MondayItem {
  id: string;
  name: string;
  updated_at: string;
  board?: { id: string };
  parent_item?: { id: string } | null;
  group?: { id: string; title: string };
  column_values: MondayColumnValue[];
}

export const parseJson = <T = unknown>(v: string | null | undefined): T | null => {
  try {
    return JSON.parse(v || 'null') as T;
  } catch {
    return null;
  }
};
export const col = (item: MondayItem, id: string) => item.column_values.find((c) => c.id === id);
const text = (item: MondayItem, id: string) => col(item, id)?.text || '';

/** Thai date of `now` as YYYY-MM-DD. */
export function thaiToday(now = Date.now()) {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
}
/** Server clock in Thai time, e.g. 2026-09-28 14:05:09 — the device clock on a phone can be wrong. */
export function thaiTimestamp(now = Date.now()) {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

export type HandoffItem = ReturnType<typeof normalize>;

/** Flatten a board item for the UI. `labels`: the customer dropdown's settings. */
export function normalize(item: MondayItem, labels: { id: number; name: string }[]) {
  const selected = parseJson<{ ids?: number[] }>(col(item, COLUMNS.customer)?.value)?.ids ?? [];
  const customer =
    text(item, COLUMNS.customer) ||
    selected.map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean).join(', ') ||
    text(item, 'text0');
  return {
    id: item.id,
    name: item.name,
    customer: customer || item.name,
    date: text(item, COLUMNS.date),
    period: text(item, 'single_select1'),
    type: text(item, 'single_select5'),
    location: text(item, 'short_text308'),
    contact: text(item, 'short_text'),
    note: text(item, 'short_text7'),
    status: text(item, COLUMNS.status),
    statusValue: col(item, COLUMNS.status)?.value || '',
    updatedAt: item.updated_at,
    group: item.group?.title ?? null,
    files: (parseJson<{ files?: { name?: string; assetId?: number }[] }>(col(item, COLUMNS.files)?.value)?.files ?? []).map((f) => ({ name: f.name ?? '' })),
    documents: DOCUMENT_PAIRS.map(([title, a, b]) => ({ title, detail: text(item, a), quantity: text(item, b) })).filter((d) => d.detail || d.quantity),
  };
}

const unavailable = (status = 502) => new DomainError('MONDAY_UNAVAILABLE', 'ติดต่อ monday ไม่สำเร็จ กรุณาลองอีกครั้ง', status);

/** Text columns for the signer's name and save time — monday assigns their ids per board, so they come from config. */
export interface SignerColumns {
  signer: string;
  signedAt: string;
}

export class MondayClient {
  constructor(
    private readonly token: string,
    readonly boardId: string,
    private readonly signerColumns: SignerColumns,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async call<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.transport('https://api.monday.com/v2', {
        method: 'POST',
        headers: { Authorization: this.token, 'API-Version': '2026-07', 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw unavailable();
    }
    const data = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
    if (!res.ok || data.errors || !data.data) throw unavailable(res.status === 429 ? 429 : 502);
    return data.data;
  }

  private groupQuery(today: string) {
    return GROUPS.map((g, i) => {
      const dateRule = g.future
        ? '{column_id:"date",compare_value:[""],operator:is_not_empty}'
        : `{column_id:"date",compare_value:["EXACT","${today}"],operator:lower_than_or_equal}`;
      return `g${i}:groups(ids:${JSON.stringify([g.id])}){id title items_page(limit:${GROUP_LIMIT},query_params:{rules:[${dateRule}],order_by:[{column_id:"date",direction:desc}]}){items{${listFields}}}}`;
    }).join(' ');
  }

  /** Every tab in one request: the latest 30 dated main items per group, newest first. */
  async listGroups() {
    const today = thaiToday();
    type Board = { name: string; columns: { settings_str: string }[] } & Record<string, { title: string; items_page: { items: MondayItem[] } }[]>;
    const data = await this.call<{ boards: Board[] }>(`query{boards(ids:[${this.boardId}]){name columns(ids:["dropdown"]){settings_str} ${this.groupQuery(today)}}}`);
    const board = data.boards?.[0];
    if (!board) throw new DomainError('MONDAY_FORBIDDEN', 'บัญชี monday ที่ตั้งค่าไว้ไม่มีสิทธิ์อ่านบอร์ดนี้', 403);
    const labels = parseJson<{ labels?: { id: number; name: string }[] }>(board.columns?.[0]?.settings_str)?.labels ?? [];
    return {
      board: board.name,
      today,
      groups: GROUPS.map((g, i) => {
        const page = (board[`g${i}`] as unknown as { title: string; items_page: { items: MondayItem[] } }[] | undefined)?.[0];
        const rows = page?.items_page.items ?? [];
        return { key: g.key, title: page?.title ?? g.title, items: rows.filter((r) => !r.parent_item).map((r) => normalize(r, labels)).filter((it) => it.date) };
      }),
    };
  }

  /** One main item of the allowed board, after checking the board still has the expected columns and status labels. */
  async item(id: string) {
    if (!/^\d{1,20}$/.test(id)) throw new DomainError('BAD_ITEM', 'เลขรายการไม่ถูกต้อง', 400);
    type Board = { columns: { id: string; type: string; settings_str: string }[]; items_page: { items: MondayItem[] } };
    const { signer, signedAt } = this.signerColumns;
    const data = await this.call<{ boards: Board[] }>(
      `query($ids:[ID!]){boards(ids:[${this.boardId}]){columns(ids:${JSON.stringify([COLUMNS.customer, COLUMNS.status, COLUMNS.files, signer, signedAt])}){id type settings_str} items_page(limit:1,query_params:{ids:$ids}){items{${detailFields}}}}}`,
      { ids: [id] },
    );
    const board = data.boards?.[0];
    const item = board?.items_page.items[0];
    if (!item || item.board?.id !== this.boardId || item.parent_item) throw new DomainError('NOT_FOUND', 'ไม่พบรายการหลักในบอร์ดที่อนุญาต', 404);
    const colOf = (cid: string) => board.columns.find((c) => c.id === cid);
    const statusLabels = parseJson<{ labels?: Record<string, string> }>(colOf(COLUMNS.status)?.settings_str)?.labels;
    const ok =
      colOf(COLUMNS.status)?.type === 'status' &&
      colOf(COLUMNS.files)?.type === 'file' &&
      [signer, signedAt].every((cid) => colOf(cid)?.type === 'text') &&
      Object.entries(OUTCOMES).every(([index, label]) => statusLabels?.[index] === label);
    if (!ok) throw new DomainError('BOARD_CHANGED', 'คอลัมน์หรือชื่อสถานะในบอร์ด monday เปลี่ยนไป กรุณาให้ผู้ดูแลตรวจการเชื่อมต่อ', 409);
    const labels = parseJson<{ labels?: { id: number; name: string }[] }>(colOf(COLUMNS.customer)?.settings_str)?.labels ?? [];
    return { item, labels };
  }

  async upload(id: string, png: Buffer, filename: string, idempotencyKey: string) {
    const form = new FormData();
    form.append('query', `mutation($file:File!){add_file_to_column(item_id:${id},column_id:"${COLUMNS.files}",file:$file){id}}`);
    form.append('map', JSON.stringify({ image: 'variables.file' }));
    form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), filename);
    let res: Response;
    try {
      res = await this.transport('https://api.monday.com/v2/file', {
        method: 'POST',
        headers: { Authorization: this.token, 'API-Version': '2026-07', 'Idempotency-Key': idempotencyKey },
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new DomainError('UPLOAD_UNCONFIRMED', 'ยังยืนยันการบันทึกหลักฐานไม่ได้ กรุณากดส่งซ้ำด้วยรายการเดิม', 502);
    }
    const data = (await res.json().catch(() => ({}))) as { data?: { add_file_to_column?: { id?: string } }; errors?: unknown };
    if (!res.ok || data.errors || !data.data?.add_file_to_column?.id) {
      throw new DomainError('UPLOAD_UNCONFIRMED', 'ยังยืนยันการบันทึกหลักฐานไม่ได้ กรุณากดส่งซ้ำด้วยรายการเดิม', 502);
    }
    return data.data.add_file_to_column.id;
  }

  /** Status, signer and time in ONE mutation so they land together or not at all. */
  saveResult(id: string, outcome: Outcome, signer: string, signedAt: string, idempotencyKey: string) {
    return this.call(
      `mutation($item:ID!,$values:JSON!){change_multiple_column_values(board_id:${this.boardId},item_id:$item,column_values:$values){id}}`,
      { item: id, values: JSON.stringify({ [COLUMNS.status]: { index: Number(outcome) }, [this.signerColumns.signer]: signer, [this.signerColumns.signedAt]: signedAt }) },
      idempotencyKey,
    );
  }
}
