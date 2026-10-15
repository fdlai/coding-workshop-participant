import { act, renderHook, waitFor } from '@testing-library/react';
import useFetch from '../useFetch';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useFetch', () => {
  it('starts loading, then exposes the data', async () => {
    const loader = jest.fn().mockResolvedValue(['a']);
    const { result } = renderHook(() => useFetch(loader));
    expect(result.current).toMatchObject({ loading: true, data: null, error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(['a']);
    expect(result.current.error).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('exposes errors', async () => {
    const error = new Error('boom');
    const { result } = renderHook(() => useFetch(() => Promise.reject(error)));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeNull();
  });

  it('reload refetches and keeps the previous data while loading', async () => {
    const second = deferred();
    const loader = jest.fn().mockResolvedValueOnce('v1').mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useFetch(loader));
    await waitFor(() => expect(result.current.data).toBe('v1'));

    act(() => result.current.reload());
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe('v1');

    await act(async () => second.resolve('v2'));
    expect(result.current).toMatchObject({ loading: false, data: 'v2' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous data when a refetch fails', async () => {
    const loader = jest.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useFetch(loader));
    await waitFor(() => expect(result.current.data).toBe('v1'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe('v1');
    expect(result.current.error.message).toBe('offline');
  });

  it('refetches when deps change and ignores stale responses', async () => {
    const pending = { 1: deferred(), 2: deferred() };
    const loader = jest.fn((id) => pending[id].promise);
    const { result, rerender } = renderHook(({ id }) => useFetch(() => loader(id), [id]), {
      initialProps: { id: 1 },
    });
    rerender({ id: 2 });
    expect(loader).toHaveBeenCalledTimes(2);

    await act(async () => pending[2].resolve('second'));
    expect(result.current.data).toBe('second');
    // The first request finishing late must not overwrite the newer result.
    await act(async () => pending[1].resolve('first'));
    expect(result.current.data).toBe('second');
    expect(result.current.loading).toBe(false);
  });

  it('ignores a stale failure after deps change', async () => {
    const first = deferred();
    const loader = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('fresh');
    const { result, rerender } = renderHook(({ id }) => useFetch(loader, [id]), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.data).toBe('fresh'));
    await act(async () => first.reject(new Error('stale')));
    expect(result.current.error).toBeNull();
  });
});
