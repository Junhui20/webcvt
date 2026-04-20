import { describe, expect, it, vi } from 'vitest';
import { SerialQueue } from './queue.ts';

describe('SerialQueue — ordering', () => {
  it('executes 5 concurrent enqueues in FIFO order', async () => {
    const queue = new SerialQueue();
    const order: number[] = [];

    const tasks = [1, 2, 3, 4, 5].map((n) =>
      queue.enqueue(async () => {
        order.push(n);
        return n;
      }),
    );

    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns correct values per task', async () => {
    const queue = new SerialQueue();
    const [a, b, c] = await Promise.all([
      queue.enqueue(async () => 'first'),
      queue.enqueue(async () => 'second'),
      queue.enqueue(async () => 'third'),
    ]);
    expect(a).toBe('first');
    expect(b).toBe('second');
    expect(c).toBe('third');
  });

  it('continues after a task throws', async () => {
    const queue = new SerialQueue();
    const results: string[] = [];

    await queue.enqueue(async () => {
      results.push('before-throw');
    });

    const failing = queue.enqueue(async () => {
      throw new Error('task error');
    });

    await queue.enqueue(async () => {
      results.push('after-throw');
    });

    await expect(failing).rejects.toThrow('task error');
    expect(results).toEqual(['before-throw', 'after-throw']);
  });
});

describe('SerialQueue — pre-start abort (Trap #16 tier 1)', () => {
  it('rejects immediately without calling task if signal is already aborted', async () => {
    const queue = new SerialQueue();
    const ac = new AbortController();
    ac.abort();

    const taskFn = vi.fn(async () => 'done');
    await expect(queue.enqueue(taskFn, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(taskFn).not.toHaveBeenCalled();
  });
});

describe('SerialQueue — mid-run abort (Trap #16 tier 2)', () => {
  it('rejects mid-run when signal is aborted during task execution', async () => {
    const queue = new SerialQueue();
    const ac = new AbortController();

    const abortPromise = queue.enqueue(
      () =>
        new Promise<string>((resolve) => {
          // Task that resolves after abort fires
          setTimeout(resolve, 100, 'too-late');
        }),
      ac.signal,
    );

    // Abort while the task is "running"
    ac.abort();

    await expect(abortPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('SerialQueue — cleanup of abort handler on success/failure', () => {
  it('removes abort listener after task succeeds with a signal', async () => {
    const queue = new SerialQueue();
    const ac = new AbortController();

    const result = await queue.enqueue(async () => 'done', ac.signal);
    expect(result).toBe('done');
    // If the handler wasn't removed, aborting now would cause stale reject
    expect(() => ac.abort()).not.toThrow();
  });

  it('removes abort listener after task rejects with a signal', async () => {
    const queue = new SerialQueue();
    const ac = new AbortController();

    await expect(
      queue.enqueue(async () => {
        throw new Error('task error');
      }, ac.signal),
    ).rejects.toThrow('task error');

    // Should not throw
    expect(() => ac.abort()).not.toThrow();
  });
});

describe('SerialQueue — drain', () => {
  it('drain() resolves after all queued tasks settle', async () => {
    const queue = new SerialQueue();
    const done: number[] = [];

    queue.enqueue(async () => done.push(1));
    queue.enqueue(async () => done.push(2));
    queue.enqueue(async () => done.push(3));

    await queue.drain();
    expect(done).toEqual([1, 2, 3]);
  });

  it('drain() resolves even if tasks reject', async () => {
    const queue = new SerialQueue();
    queue.enqueue(async () => {
      throw new Error('boom');
    });
    queue.enqueue(async () => undefined);

    await expect(queue.drain()).resolves.toBeUndefined();
  });
});
