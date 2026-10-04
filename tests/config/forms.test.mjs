import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// Node strips TypeScript; resolve the runtime constants import without changing
// application imports or creating a shared compilation directory.
registerHooks({resolve(specifier, context, next) {
  return context.parentURL?.endsWith('/lib/forms.ts') && specifier === './forms-types'
    ? next(new URL('./forms-types.ts', context.parentURL).href, context)
    : next(specifier, context);
}});
const {
  formsMutation, formsSchema, formsAnswersValid, formsParseJSON, formsReadBody,
  formsReconcileMutation, parseFormsQuery, parseFormsFormQuery,
  parseFormsResponseQuery, parseFormsResponsesQuery, parseFormsRosterQuery,
  decodeFormsCursor, readForms, readFormsRoster, readFormsForm,
  readFormsResponses, readFormsResponse, reconcileForm, saveForm,
} = await import('../../lib/forms.ts');

const tenantId = '88000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000901';
const id = n => `6f100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [formId, responseId, operationId, fieldId, optionId, foreignId] = [1,2,3,4,5,6].map(id);
const version = 'a'.repeat(32), changedVersion = 'b'.repeat(32);
const serverTime = '2026-10-04T01:02:03.123456Z';
const editedTime = '2026-10-01T08:30:00.654321Z';
const identity = {tenantId, actorId, role: 'owner'};
const company = {id: tenantId, name: 'Synthetic', time_zone: 'UTC'};
const capabilities = {canEdit: true, canPublish: false, canArchive: true, canRestore: false,
  canSaveProgress: false, canSubmit: false, canEditResponse: false, canViewResponses: true};
const form = {id: formId, name: 'Form', description: '', status: 'draft', restoreStatus: null,
  revision: 1, schemaFrozen: false, allowRespondentEdit: false, isAssigned: false,
  audienceCount: 0, eligibleAudienceCount: 0, createdAt: serverTime, updatedAt: serverTime,
  capabilities, ownResponse: null};
const published = {...form, status: 'published', schemaFrozen: true};
const catalog = {...identity, view: 'manage', company, forms: [form],
  counts: {total: 1, draft: 1, published: 0, archived: 0}, catalogVersion: version,
  nextCursor: null, capabilities: {canManage: true}, serverTime};
const access = {...identity, view: 'manage', collectionVersion: version,
  formRevision: null, responseRevision: null};
const query = {tenantId, view: 'manage', status: 'all', search: '', limit: 50};
const create = {action: 'create_form', name: 'Form', description: '', schema: [],
  audienceIds: [], allowRespondentEdit: false};
const mutation = change => ({tenantId, operationId, change});
const textField = {id: fieldId, kind: 'text', label: 'Required', required: true};
const numberField = {...textField, kind: 'number'};
const schema = [textField];
const response = {id: responseId, formId, actorId, authorName: 'Original author', revision: 3,
  status: 'submitted', submittedAt: editedTime, updatedAt: serverTime,
  lastEditedBy: actorId, lastEditorName: 'Original editor', lastEditedAt: editedTime,
  reviewed: false, reviewedAt: null, reviewedBy: null, reviewerName: null,
  canEdit: true, canReview: true, answers: {[fieldId]: 'Retained original'},
  schema, formName: 'Original title'};
const summary = value => {
  const result = {...value};
  for (const key of ['answers', 'schema', 'formName']) delete result[key];
  return result;
};
const historyItem = revision => {
  const result = {...response};
  for (const key of ['schema', 'canEdit', 'canReview', 'actorId', 'authorName', 'formId']) delete result[key];
  return {...result, id: id(100 + revision), responseId, revision,
    answers: {[fieldId]: `Previous ${revision}`}, retainedAt: serverTime};
};
const responseData = {...identity, form: published, response, history: [historyItem(2), historyItem(1)],
  historyCount: 2, collectionVersion: version, nextCursor: null, serverTime};
const responseQuery = {tenantId, formId, responseId, limit: 10};
const responsesQuery = {tenantId, formId, status: 'all', review: 'all', search: '', limit: 50};
const responseAccess = {...access, formRevision: 1, responseRevision: 3};
const responsesData = {...identity, form: published, responses: [summary(response)],
  counts: {total: 1, reviewed: 0, notReviewed: 1}, collectionVersion: version,
  nextCursor: null, serverTime};
function fixture(data = catalog, current = access, error = null, accessError = null) {
  const calls = [];
  return {calls, client: {
    auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
    rpc: async (name, args) => {
      calls.push({name, args});
      return name === 'read_forms_access'
        ? {data: current, error: accessError} : {data, error};
    },
  }};
}
const rejects = (promise, status = 503) => assert.rejects(promise, error => error.status === status);
const badQuery = fn => assert.throws(fn, error => error.status === 400);
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const cursor = (kind, position, extra = {}) => ({scope: {...identity, kind, view: 'manage',
  formId: null, responseId: null, status: 'all', review: 'all', search: '', version, ...extra}, position});
const savedFor = (action, extra = {}) => ({...identity, operationId, action, formId,
  formRevision: 1, updatedAt: serverTime, ...extra});

test('Forms strict singular bounded queries retain literal search and canonical IDs', () => {
  assert.deepEqual(parseFormsQuery(new URLSearchParams({tenantId})),
    {tenantId, view: 'mine', status: 'all', search: '', limit: 50});
  assert.equal(parseFormsFormQuery(new URLSearchParams({tenantId}), formId.toUpperCase()).formId, formId);
  assert.equal(parseFormsResponsesQuery(new URLSearchParams({tenantId}), formId).review, 'all');
  const literal = '%_\\ İ 😀';
  assert.equal(parseFormsRosterQuery(new URLSearchParams({tenantId, search: literal, limit: '100'})).search, literal);
  for (const patch of [{limit: '101'}, {limit: '1.5'}, {limit: '0'}, {search: '😀'.repeat(51)},
    {view: 'auto'}, {status: 'in_progress'}, {unknown: 'x'}, {cursor: 'bad='}, {tenantId: 'bad'}])
    badQuery(() => parseFormsQuery(new URLSearchParams({tenantId, ...patch})));
  badQuery(() => parseFormsQuery(new URLSearchParams(`tenantId=${tenantId}&status=all&status=all`)));
  badQuery(() => parseFormsFormQuery(new URLSearchParams({tenantId, search: 'x'}), formId));
  badQuery(() => parseFormsRosterQuery(new URLSearchParams({tenantId, view: 'manage'})));
  badQuery(() => parseFormsResponsesQuery(new URLSearchParams({tenantId, review: 'pending'}), formId));
});

test('History has a separate ten-entry default and hard maximum', () => {
  assert.equal(parseFormsResponseQuery(new URLSearchParams({tenantId}), formId, responseId).limit, 10);
  assert.equal(parseFormsResponseQuery(new URLSearchParams({tenantId, limit: '1'}), formId, responseId).limit, 1);
  for (const suffix of ['limit=11', 'limit=0', 'limit=1.5', 'search=private', 'limit=5&limit=10'])
    badQuery(() => parseFormsResponseQuery(new URLSearchParams(`tenantId=${tenantId}&${suffix}`), formId, responseId));
  badQuery(() => parseFormsResponseQuery(new URLSearchParams({tenantId}), 'bad', responseId));
});

test('Duplicate JSON properties are per-object and decoded escape-equivalent keys collide', () => {
  const fields = [{id: fieldId, kind: 'single_choice', label: 'One', required: true,
    options: [{id: optionId, label: 'Choice'}]}, {id: responseId, kind: 'multiple_choice', label: 'Many', required: false,
    options: [{id: optionId, label: 'Choice'}]}];
  assert.equal(formsMutation.safeParse(formsParseJSON(JSON.stringify(mutation({...create, schema: fields})))).success, true);
  for (const raw of ['{"a":1,"a":2}', '{"a":{"id":1,"\\u0069d":2}}',
    '{"change":{"schema":[{"id":1,"id":2}]}}', '{"change":{"answers":{"x":1,"x":2}}}'])
    badQuery(() => formsParseJSON(raw));
  for (const raw of ['{"a":1} trailing', '{"a":}', '[1,]', '{"a":"unterminated}'])
    badQuery(() => formsParseJSON(raw));
});

test('UTF16 names retain original valid Unicode and controls; whitespace-only and invalid Unicode fail', () => {
  assert.equal(formsMutation.safeParse(mutation({...create, name: '😀'.repeat(50)})).success, true);
  assert.equal(formsMutation.parse(mutation({...create, name: ' \nOriginal 😀\t'})).change.name, ' \nOriginal 😀\t');
  for (const name of ['😀'.repeat(51), '\0', '\ud800', '\udc00', '\t\v\f\r'])
    assert.equal(formsMutation.safeParse(mutation({...create, name})).success, false);
  for (const value of [mutation({...create, unexpected: true}), {...mutation(create), private: 'x'},
    mutation({...create, audienceIds: [actorId, actorId.toUpperCase()]}),
    mutation({action: 'archive_form', formId, formRevision: 2147483648})])
    assert.equal(formsMutation.safeParse(value).success, false);
});

test('All six fields enforce stable schema identities, option bounds, and hidden answer rejection', () => {
  const all = [{id: id(10), kind: 'description', text: 'Original\n guidance'}, textField,
    {id: id(11), kind: 'yes_no', label: 'Agree', required: true},
    {id: id(12), kind: 'single_choice', label: 'One', required: true, options: [{id: optionId, label: 'Original'}]},
    {id: id(13), kind: 'multiple_choice', label: 'Many', required: false, options: [{id: optionId, label: 'Original'}]},
    {...numberField, id: id(14)}];
  const answers = {[fieldId]: ' exact ', [id(11)]: false, [id(12)]: optionId,
    [id(13)]: [], [id(14)]: '123456789012.123456'};
  assert.equal(formsSchema.safeParse(all).success, true);
  assert.equal(formsAnswersValid(all, answers, true), true);
  assert.equal(formsAnswersValid(all, {...answers, [id(10)]: 'forged'}, false), false);
  assert.equal(formsAnswersValid(all, {...answers, [foreignId]: 'unknown'}, false), false);
  assert.equal(formsSchema.safeParse([textField, textField]).success, false);
  assert.equal(formsSchema.safeParse([{...textField, private: 'forged'}]).success, false);
  assert.equal(formsSchema.safeParse([{...all[3], options: [{id: optionId, label: 'A'},
    {id: optionId.toUpperCase(), label: 'B'}]}]).success, false);
  assert.equal(formsSchema.safeParse([{...all[3], options: []}]).success, false);
  assert.equal(formsSchema.safeParse([{...all[3], options: Array.from({length: 51}, (_, i) => ({id: id(1000+i), label: 'Choice'}))}]).success, false);
});

test('Required boolean false is complete; omission, blank required text and empty required choices are not', () => {
  const boolean = {...textField, kind: 'yes_no'};
  assert.equal(formsAnswersValid([boolean], {[fieldId]: false}, true), true);
  assert.equal(formsAnswersValid([boolean], {}, true), false);
  assert.equal(formsAnswersValid([boolean], {[fieldId]: 'false'}, true), false);
  for (const value of ['', ' \t\n\u00a0']) assert.equal(formsAnswersValid([textField], {[fieldId]: value}, true), false);
  assert.equal(formsAnswersValid([textField], {[fieldId]: ' \t'}, false), true);
  const multiple = {...textField, kind: 'multiple_choice', options: [{id: optionId, label: 'Choice'}]};
  assert.equal(formsAnswersValid([multiple], {[fieldId]: []}, true), false);
  assert.equal(formsAnswersValid([{...multiple, required: false}], {[fieldId]: []}, true), true);
});

test('Numeric draft strings preserve incomplete typing; submission preserves precise decimal strings', () => {
  for (const value of ['', '-', '+', '.', '+.', '123.'])
    assert.equal(formsAnswersValid([numberField], {[fieldId]: value}, false), true, value);
  for (const value of ['0', '-0.123456', '+123456789012.123456', '999999999999.999999'])
    assert.equal(formsAnswersValid([numberField], {[fieldId]: value}, true), true, value);
  for (const value of ['', '-', '1234567890123', '1.1234567', '1e2', 'NaN', 'Infinity', '1.', ' 1'])
    assert.equal(formsAnswersValid([numberField], {[fieldId]: value}, true), false, value);
  assert.equal(formsAnswersValid([numberField], {[fieldId]: 1}, true), false);
  assert.equal(formsAnswersValid([{...numberField, required: false}], {}, true), true);
  assert.equal(formsAnswersValid([{...numberField, required: false}], {[fieldId]: ''}, true), false);
  const value = mutation({action: 'submit_response', formId, formRevision: 1, responseRevision: 0,
    answers: {[fieldId]: '999999999999.999999'}});
  assert.equal(formsMutation.parse(value).change.answers[fieldId], '999999999999.999999');
});

test('Uppercase choice UUIDs compare canonically while duplicate alternatives remain forbidden', () => {
  const choice = {...textField, kind: 'single_choice', options: [{id: optionId, label: 'Original'}]};
  assert.equal(formsAnswersValid([choice], {[fieldId]: optionId.toUpperCase()}, true), true);
  assert.equal(formsAnswersValid([choice], {[fieldId]: foreignId}, true), false);
  const multiple = {...choice, kind: 'multiple_choice'};
  assert.equal(formsAnswersValid([multiple], {[fieldId]: [optionId.toUpperCase()]}, true), true);
  assert.equal(formsAnswersValid([multiple], {[fieldId]: [optionId, optionId.toUpperCase()]}, true), false);
  const parsed = formsMutation.parse(mutation({action: 'save_progress', formId, formRevision: 1, responseRevision: 0,
    answers: {[fieldId.toUpperCase()]: [optionId.toUpperCase()]}}));
  assert.deepEqual(parsed.change.answers, {[fieldId]: [optionId]});
});

test('Raw schema128KiB and answers64KiB limits count subtree whitespace before normalization', () => {
  const schemaAt = '{"change":{"schema":[' + ' '.repeat(131070) + ']}}';
  const answersAt = '{"change":{"answers":{' + ' '.repeat(65534) + '}}}';
  assert.deepEqual(formsParseJSON(schemaAt), {change: {schema: []}});
  assert.deepEqual(formsParseJSON(answersAt), {change: {answers: {}}});
  assert.throws(() => formsParseJSON(schemaAt.replace(']}', ' ]}')), e => e.status === 413);
  assert.throws(() => formsParseJSON(answersAt.replace('}}}', ' }}}')), e => e.status === 413);
  assert.throws(() => formsParseJSON('{"change":{"schema":["' + '\\u0001'.repeat(23000) + '"]}}'), e => e.status === 413);
});

test('Semantic schema and combined answers budgets reject legal per-field content exceeding aggregate limits', () => {
  const fields = n => Array.from({length: n}, (_, i) => ({id: id(1000+i), kind: 'description', text: 'x'.repeat(5000)}));
  assert.equal(formsMutation.safeParse(mutation({...create, schema: fields(25)})).success, true);
  assert.equal(formsMutation.safeParse(mutation({...create, schema: fields(27)})).success, false);
  const answers = n => Object.fromEntries(Array.from({length: n}, (_, i) => [id(1000+i), 'x'.repeat(5000)]));
  const save = answers => mutation({action: 'save_progress', formId, formRevision: 1, responseRevision: 0, answers});
  // Thirteen36-character keys, twelve5000-character values and one4964 value
  // occupy exactly65536 bytes in PostgreSQL's spaced JSON representation.
  const at = {...answers(13), [id(1012)]: 'x'.repeat(4964)};
  assert.equal(formsMutation.safeParse(save(at)).success, true);
  assert.equal(formsMutation.safeParse(save({...at, [id(1012)]: 'x'.repeat(4965)})).success, false);
  assert.equal(formsMutation.safeParse(save(answers(14))).success, false);
  assert.equal(formsMutation.safeParse(mutation({...create, schema: fields(50).map(f => ({...f, text: '\u0001'.repeat(5000)}))})).success, false);
});

test('Streaming transport accepts exactly256KiB, rejects one extra byte, invalid UTF8 and false length', async () => {
  const raw = JSON.stringify(mutation(create));
  const at = raw + ' '.repeat(262144 - Buffer.byteLength(raw));
  const request = body => new Request('https://synthetic.test/api/forms', {method: 'POST', body});
  assert.deepEqual(await formsReadBody(request(at)), mutation(create));
  await rejects(formsReadBody(request(at + ' ')), 413);
  await rejects(formsReadBody(request(new Uint8Array([0xff]))), 400);
  await rejects(formsReadBody(new Request('https://synthetic.test/api/forms', {method: 'POST', headers: {'content-length': 'nope'}, body: raw})), 413);
  const unicode = JSON.stringify({...mutation(create), padding: '😀'.repeat(66000)});
  assert.ok(unicode.length < 262144);
  await rejects(formsReadBody(request(unicode)), 413);
});

test('Catalog exact counts are independent of loaded rows and read/access RPCs have no write side effects', async () => {
  const data = {...catalog, counts: {total: 1005, draft: 1005, published: 0, archived: 0}};
  const f = fixture(data);
  assert.equal((await readForms(f.client, query)).counts.total, 1005);
  assert.deepEqual(f.calls.map(c => c.name), ['read_forms', 'read_forms_access']);
  assert.equal(f.calls[0].args.page_limit, 50);
  assert.equal(f.calls[0].args.read_view, 'manage');
});

test('Missing, unsafe, fractional and incoherent counts or private extra fields never become zero success', async () => {
  for (const counts of [{}, {total: 2, draft: 1, published: 0, archived: 0},
    {total: -1, draft: -1, published: 0, archived: 0}, {total: 1.5, draft: 1.5, published: 0, archived: 0},
    {total: Number.MAX_SAFE_INTEGER+1, draft: Number.MAX_SAFE_INTEGER+1, published: 0, archived: 0}])
    await rejects(readForms(fixture({...catalog, counts}).client, query));
  for (const data of [null, {}, [], {...catalog, forms: null}, {...catalog, forms: [form, form]},
    {...catalog, tenantId: foreignId}, {...catalog, actorId: foreignId},
    {...catalog, company: {...company, id: foreignId}}, {...catalog, company: {...company, time_zone: 'Factory'}},
    {...catalog, answers: {private: 'forged'}}]) await rejects(readForms(fixture(data).client, query));
});

test('No signed or anonymous user reaches a Forms RPC', async () => {
  for (const [user, status] of [[null, 401], [{id: actorId, is_anonymous: true}, 403]]) {
    const f = fixture();
    f.client.auth.getUser = async () => ({data: {user}, error: null});
    await rejects(readForms(f.client, query), status);
    assert.equal(f.calls.length, 0);
  }
});

test('Fresh actor/company/role/view denial and version/resource conflicts withhold the old snapshot', async () => {
  for (const patch of [{actorId: foreignId}, {tenantId: foreignId}, {role: 'admin'}, {view: 'mine'}])
    await rejects(readForms(fixture(catalog, {...access, ...patch}).client, query), 403);
  await rejects(readForms(fixture(catalog, {...access, collectionVersion: changedVersion}).client, query), 409);
  await rejects(readFormsResponse(fixture(responseData, {...responseAccess, formRevision: 2}).client, responseQuery), 409);
  await rejects(readFormsResponse(fixture(responseData, {...responseAccess, responseRevision: 4}).client, responseQuery), 409);
  for (const [error, status] of [[{code: '42501'}, 403], [{code: 'XX000'}, 503]])
    await rejects(readForms(fixture(catalog, null, null, error).client, query), status);
  await rejects(readForms(fixture(catalog, {}).client, query));
});

test('Database failures are redacted and retain denial/conflict/read-failure distinctions', async () => {
  for (const [code, status] of [['42501',403], ['40001',409], ['54000',409], ['22023',400], ['22P02',400], ['XX000',503]])
    await assert.rejects(readForms(fixture(null, null, {code, message: 'private SQL diagnostic'}).client, query),
      error => error.status === status && !error.message.includes('private SQL diagnostic'));
});

test('Catalog cursor retains microsecond position and binds current scope/version/last item', async () => {
  const next = cursor('catalog', {id: formId, key: serverTime});
  const out = await readForms(fixture({...catalog, nextCursor: next}).client, {...query, limit: 1});
  assert.deepEqual(decodeFormsCursor(out.nextCursor), next);
  for (const patch of [{actorId: foreignId}, {tenantId: foreignId}, {role: 'admin'}, {view: 'mine'},
    {kind: 'roster'}, {status: 'draft'}, {search: 'other'}, {version: changedVersion}, {formId}])
    await rejects(readForms(fixture({...catalog, nextCursor: {...next, scope: {...next.scope, ...patch}}}).client, {...query, limit: 1}));
  for (const position of [{id: foreignId, key: serverTime}, {id: formId, key: '2026-10-04T01:02:03.123000Z'}])
    await rejects(readForms(fixture({...catalog, nextCursor: {...next, position}}).client, {...query, limit: 1}));
  for (const token of ['=', '!!!!', encode({}), encode(next) + '=']) badQuery(() => decodeFormsCursor(token));
  const f = fixture();
  await rejects(readForms(f.client, {...query, cursor: encode({...next, scope: {...next.scope, actorId: foreignId}})}), 409);
  assert.equal(f.calls.length, 0);
});

test('Roster Turkish SQL sort key stays opaque; exact1005 count and eligible-only pages remain distinct', async () => {
  const next = cursor('roster', {id: foreignId, key: 'i'});
  const data = {...identity, users: [{actorId: foreignId, name: 'İ', eligible: true}],
    matchedCount: 1005, rosterVersion: version, nextCursor: next, serverTime};
  const out = await readFormsRoster(fixture(data).client, {tenantId, search: '', limit: 1});
  assert.equal(decodeFormsCursor(out.nextCursor).position.key, 'i');
  assert.equal(out.matchedCount, 1005);
  for (const patch of [{users: [{...data.users[0], eligible: false}]}, {users: [data.users[0], data.users[0]]},
    {users: [{...data.users[0], email: 'private'}]}, {matchedCount: 0}])
    await rejects(readFormsRoster(fixture({...data, ...patch}).client, {tenantId, search: '', limit: 50}));
});

test('Personal detail exposes only current assigned published schema and original actor response', async () => {
  const mineForm = {...published, isAssigned: true, audienceCount: null, eligibleAudienceCount: null,
    capabilities: {...capabilities, canEdit: false, canArchive: false, canViewResponses: false,
      canSaveProgress: true, canSubmit: true}};
  const data = {...identity, view: 'mine', company, form: mineForm, schema,
    response: null, collectionVersion: version, serverTime};
  const current = {...access, view: 'mine', formRevision: 1};
  const q = {tenantId, formId, view: 'mine'};
  assert.equal((await readFormsForm(fixture(data, current).client, q)).response, null);
  for (const patch of [{assignees: []}, {history: []}, {form: {...mineForm, status: 'draft'}},
    {form: {...mineForm, isAssigned: false}}, {form: {...mineForm, audienceCount: 0}}])
    await rejects(readFormsForm(fixture({...data, ...patch}, current).client, q));
  const personalResponse = {...response, status: 'in_progress', submittedAt: null, canEdit: false, canReview: false};
  const withResponse = {...data, form: {...mineForm, ownResponse: {id: responseId, revision: 3,
    status: 'in_progress', submittedAt: null, updatedAt: serverTime}}, response: personalResponse};
  assert.equal((await readFormsForm(fixture(withResponse, current).client, q)).response.actorId, actorId);
  for (const patch of [{actorId: foreignId}, {formId: foreignId}, {id: foreignId}, {revision: 4}])
    await rejects(readFormsForm(fixture({...withResponse, response: {...personalResponse, ...patch}}, current).client, q));
});

test('Management does not accept private in-progress responses or personal-answer detail fields', async () => {
  assert.equal((await readFormsResponses(fixture(responsesData, {...access, formRevision: 1}).client, responsesQuery)).responses.length, 1);
  const progress = {...response, status: 'in_progress', submittedAt: null};
  await rejects(readFormsResponses(fixture({...responsesData, responses: [summary(progress)]}).client, responsesQuery));
  await rejects(readFormsResponse(fixture({...responseData, response: progress}, responseAccess).client, responseQuery));
  const detail = {...identity, company, view: 'manage', form, schema, assignees: [], collectionVersion: version, serverTime};
  await rejects(readFormsForm(fixture({...detail, response: progress}, {...access, formRevision: 1}).client,
    {tenantId, formId, view: 'manage'}));
});

test('Submitted frozen schema and historical lastEditedAt remain separate from review updatedAt', async () => {
  const out = await readFormsResponse(fixture(responseData, responseAccess).client, responseQuery);
  assert.equal(out.response.lastEditedAt, editedTime);
  assert.equal(out.response.updatedAt, serverTime);
  assert.equal(out.history[0].lastEditedAt, editedTime);
  assert.equal(out.response.formName, 'Original title');
  const reviewed = {...response, reviewed: true, reviewedAt: serverTime, reviewedBy: foreignId, reviewerName: 'Reviewer'};
  assert.equal((await readFormsResponse(fixture({...responseData, response: reviewed}, responseAccess).client, responseQuery)).response.lastEditedAt, editedTime);
  for (const patch of [{lastEditedAt: undefined}, {lastEditedAt: 'yesterday'}, {schema: [{...textField, kind: 'unknown'}]},
    {answers: {[foreignId]: 'hidden'}}, {answers: {[fieldId]: '   '}}, {reviewed: true}])
    await rejects(readFormsResponse(fixture({...responseData, response: {...response, ...patch}}, responseAccess).client, responseQuery));
});

test('History is bounded ten/shared schema, ordered older revisions and immutable target-bound answers', async () => {
  const f = fixture(responseData, responseAccess);
  await readFormsResponse(f.client, responseQuery);
  assert.equal(f.calls[0].args.page_limit, 10);
  for (const history of [[historyItem(2), historyItem(2)], [historyItem(1), historyItem(2)], [historyItem(3)],
    [{...historyItem(2), responseId: foreignId}], [{...historyItem(2), schema}],
    [{...historyItem(2), lastEditedAt: undefined}], [{...historyItem(2), answers: {[foreignId]: 'forged'}}],
    Array.from({length: 11}, (_, i) => historyItem(20-i))])
    await rejects(readFormsResponse(fixture({...responseData, history, historyCount: 20}, responseAccess).client, responseQuery));
  const next = cursor('response', {id: historyItem(1).id, key: '1'}, {formId, responseId});
  const out = await readFormsResponse(fixture({...responseData, nextCursor: next}, responseAccess).client, responseQuery);
  assert.equal(decodeFormsCursor(out.nextCursor).position.key, '1');
  await rejects(readFormsResponse(fixture({...responseData, nextCursor: {...next, position: {...next.position, key: '2'}}}, responseAccess).client, responseQuery));
});

test('Response list exact reviewed totals and current filter cannot be replaced by incomplete or private rows', async () => {
  for (const patch of [{counts: {total: 2, reviewed: 0, notReviewed: 1}}, {responses: [summary(response), summary(response)]},
    {responses: [{...summary(response), formId: foreignId}]}, {responses: [{...summary(response), answers: {private: 'x'}}]}])
    await rejects(readFormsResponses(fixture({...responsesData, ...patch}, {...access, formRevision: 1}).client, responsesQuery));
  await rejects(readFormsResponses(fixture(responsesData, {...access, formRevision: 1}).client,
    {...responsesQuery, review: 'reviewed'}));
});

test('Create/lifecycle acknowledgments bind operation/action/form and exact resulting revision', async () => {
  assert.equal((await saveForm(fixture(savedFor('create_form')).client, mutation(create))).formRevision, 1);
  for (const patch of [{operationId: foreignId}, {action: 'edit_form'}, {formRevision: 2}, {actorId: foreignId},
    {tenantId: foreignId}, {role: 'employee'}, {responseId}, {answers: {private: 'x'}}])
    await rejects(saveForm(fixture(savedFor('create_form', patch)).client, mutation(create)));
  const change = {action: 'archive_form', formId, formRevision: 2};
  assert.equal((await saveForm(fixture(savedFor(change.action, {formRevision: 3})).client, mutation(change))).formRevision, 3);
  for (const patch of [{formId: foreignId}, {formRevision: 2}])
    await rejects(saveForm(fixture(savedFor(change.action, {formRevision: 3, ...patch})).client, mutation(change)));
});

test('Response acknowledgments bind exact action status, response target and both revisions', async () => {
  for (const action of ['save_progress', 'submit_response', 'edit_response', 'admin_edit_response', 'review_response']) {
    const change = {action, formId, formRevision: 2, responseRevision: 3,
      ...(action === 'review_response' ? {responseId, reviewed: true} : {answers: {}, ...(action === 'admin_edit_response' ? {responseId} : {})})};
    const status = action === 'save_progress' ? 'in_progress' : 'submitted';
    const ack = savedFor(action, {formRevision: 2, responseId, responseRevision: 4,
      responseStatus: status, submittedAt: status === 'submitted' ? editedTime : null});
    assert.equal((await saveForm(fixture(ack).client, mutation(change))).responseRevision, 4);
    for (const patch of [{responseRevision: 5}, {formRevision: 3}, {actorId: foreignId}, {responseId: undefined},
      {responseStatus: status === 'submitted' ? 'in_progress' : 'submitted', submittedAt: status === 'submitted' ? null : editedTime},
      {answers: {private: 'forged'}}]) await rejects(saveForm(fixture({...ack, ...patch}).client, mutation(change)));
    if ('responseId' in change) await rejects(saveForm(fixture({...ack, responseId: foreignId}).client, mutation(change)));
  }
});

test('Recovery request is field-free and both signed fresh passes precede any returned outcome', async () => {
  const request = {tenantId, operationId, action: 'save_progress'};
  for (const extra of [{answers: {}}, {formId}, {actorId}, {responseId}])
    assert.equal(formsReconcileMutation.safeParse({...request, ...extra}).success, false);
  const dto = {...identity, operationId, action: request.action, status: 'not_recorded', saved: null};
  const f = fixture(dto);
  assert.deepEqual(await reconcileForm(f.client, request), dto);
  assert.deepEqual(f.calls.map(c => c.name), ['reconcile_form_operation', 'reconcile_form_operation']);
  assert.deepEqual(f.calls[0].args, f.calls[1].args);
  let count = 0;
  f.client.rpc = async () => ++count === 1 ? {data: dto, error: null} : {data: null, error: {code: '42501'}};
  await rejects(reconcileForm(f.client, request), 403);
  assert.equal(count, 2);
  for (const patch of [{actorId: foreignId}, {tenantId: foreignId}, {operationId: foreignId},
    {action: 'submit_response'}, {status: 'recorded'}, {answers: {private: 'x'}}])
    await rejects(reconcileForm(fixture({...dto, ...patch}).client, request));
});

test('Recorded recovery receipt binds nested identity and never echoes content', async () => {
  const request = {tenantId, operationId, action: 'submit_response'};
  const saved = savedFor(request.action, {responseId, responseRevision: 3, responseStatus: 'submitted', submittedAt: editedTime});
  const dto = {...identity, operationId, action: request.action, status: 'recorded', saved};
  assert.equal((await reconcileForm(fixture(dto).client, request)).saved.responseId, responseId);
  for (const patch of [{role: 'admin'}, {actorId: foreignId}, {tenantId: foreignId}, {operationId: foreignId},
    {action: 'edit_response'}, {answers: {private: 'x'}},
    {responseStatus: 'in_progress', submittedAt: null}])
    await rejects(reconcileForm(fixture({...dto, saved: {...saved, ...patch}}).client, request));
});

test('Management recovery receipts require current management role and initial create revision', async () => {
  const request = {tenantId, operationId, action: 'create_form'};
  const saved = savedFor('create_form');
  const dto = {...identity, operationId, action: request.action, status: 'recorded', saved};
  assert.equal((await reconcileForm(fixture(dto).client, request)).saved.formRevision, 1);
  await rejects(reconcileForm(fixture({...dto, role: 'employee', saved: {...saved, role: 'employee'}}).client, request));
  await rejects(reconcileForm(fixture({...dto, saved: {...saved, formRevision: 2}}).client, request));
});
