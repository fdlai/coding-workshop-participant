import { ApiError, onUnauthorized, request, tokenStore } from '../api';

function respond(status, body, { badJson = false } = {}) {
  global.fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: badJson ? () => Promise.reject(new Error('not json')) : () => Promise.resolve(body),
  });
}

describe('request()', () => {
  afterEach(() => onUnauthorized(null));

  it('builds the URL, skips empty params and returns parsed JSON', async () => {
    respond(200, [{ id: 1 }]);
    const data = await request('/projects', { params: { status: 'active', search: '', manager: null, page: 0 } });
    expect(data).toEqual([{ id: 1 }]);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/v1/projects?status=active&page=0');
    expect(options.method).toBe('GET');
    expect(options.headers).toEqual({});
    expect(options.body).toBeUndefined();
  });

  it('sends a JSON body and the bearer token', async () => {
    tokenStore.set('abc');
    respond(200, { ok: true });
    await request('/projects', { method: 'POST', body: { name: 'X' } });
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer abc' });
    expect(options.body).toBe('{"name":"X"}');
  });

  it('omits the token when auth is false', async () => {
    tokenStore.set('abc');
    respond(200, {});
    await request('/auth/login', { method: 'POST', body: {}, auth: false });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('returns null for 204 No Content', async () => {
    respond(204, null);
    await expect(request('/milestones/1', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('throws ApiError with the string detail', async () => {
    respond(409, { detail: 'Assignment overlaps' });
    const error = await request('/x').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('Assignment overlaps');
  });

  it('formats FastAPI validation errors', async () => {
    respond(422, { detail: [{ loc: ['body', 'name'], msg: 'Field required' }, { msg: 'Bad' }] });
    await expect(request('/x')).rejects.toThrow('name: Field required; : Bad');
  });

  it('falls back to a generic message when the body is not JSON', async () => {
    respond(500, null, { badJson: true });
    await expect(request('/x')).rejects.toThrow('Request failed (500)');
  });

  it('reports network failures as status 0', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await request('/x').catch((e) => e);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/Unable to reach the server/);
  });

  it('calls the unauthorized handler on 401 for authenticated requests only', async () => {
    const handler = jest.fn();
    onUnauthorized(handler);
    respond(401, { detail: 'Expired' });
    await expect(request('/auth/me')).rejects.toThrow('Expired');
    expect(handler).toHaveBeenCalledTimes(1);

    respond(401, { detail: 'Invalid credentials' });
    await expect(request('/auth/login', { auth: false })).rejects.toThrow('Invalid credentials');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('tokenStore', () => {
  it('stores, reads and clears the token', () => {
    tokenStore.set('t1');
    expect(tokenStore.get()).toBe('t1');
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });
});
