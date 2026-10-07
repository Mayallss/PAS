import { MondayClient, OUTCOMES } from './monday.client';

/** Moving to another board: the signer / time columns come from config, and a board without them refuses to save. */
const BOARD = '1862570548';
const statusLabels = { ...OUTCOMES, '5': 'รอดำเนินการ' };

function fakeBoard(textColumns: string[], sent: { query: string; variables: Record<string, unknown> }[]) {
  const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push(body);
    if (String(body.query).includes('change_multiple_column_values')) return ok({ change_multiple_column_values: { id: '42' } });
    const requested: string[] = JSON.parse(String(body.query).match(/columns\(ids:(\[[^\]]*\])/)![1]);
    const all = [
      { id: 'dropdown', type: 'dropdown', settings_str: '{"labels":[]}' },
      { id: 'single_select_1', type: 'status', settings_str: JSON.stringify({ labels: statusLabels }) },
      { id: 'signature', type: 'file', settings_str: '{}' },
      ...textColumns.map((id) => ({ id, type: 'text', settings_str: '{}' })),
    ];
    const item = { id: '42', name: 'ticket', updated_at: '2026-10-07T01:00:00Z', board: { id: BOARD }, parent_item: null, column_values: [] };
    return ok({ boards: [{ columns: all.filter((c) => requested.includes(c.id)), items_page: { items: [item] } }] });
  }) as unknown as typeof fetch;
}

it('reads and writes the signer / time columns it was configured with', async () => {
  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  const client = new MondayClient('token', BOARD, { signer: 'text_new_signer', signedAt: 'text_new_time' }, fakeBoard(['text_new_signer', 'text_new_time'], sent));
  await expect(client.item('42')).resolves.toMatchObject({ item: { id: '42' } });
  await client.saveResult('42', '1', 'ผู้รับ', '2026-10-07 09:00:00', 'key-1');
  expect(JSON.parse(String(sent.at(-1)!.variables.values))).toEqual({
    single_select_1: { index: 1 },
    text_new_signer: 'ผู้รับ',
    text_new_time: '2026-10-07 09:00:00',
  });
});

it('a board that lacks the configured columns refuses before anything is written', async () => {
  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  const client = new MondayClient('token', BOARD, { signer: 'text_mm7mkazh', signedAt: 'text_mm7mtsjf' }, fakeBoard([], sent));
  const err = await client.item('42').catch((e: { getResponse(): object }) => e.getResponse());
  expect(err).toMatchObject({ code: 'BOARD_CHANGED' });
  expect(sent.some((s) => s.query.includes('mutation'))).toBe(false);
});
