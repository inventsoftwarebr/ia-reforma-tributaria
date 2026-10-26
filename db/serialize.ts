/**
 * Uma consulta por vez na conexão, sem depender de `max_pipeline`.
 *
 * Com várias consultas em paralelo (Promise.all numa página), o postgres-js
 * envia todas juntas pela mesma conexão (pipelining), e o Supavisor em
 * transaction mode pode nunca responder — o painel ficava "carregando" para
 * sempre. Desligar com `max_pipeline: 0` resolve isso, mas quebra transações:
 * o postgres-js só registra a conexão do `begin` quando pode enviar em lote
 * ("Cannot set properties of undefined (setting 'onclose')").
 *
 * Aqui a fila fica na frente do cliente: cada consulta (e cada transação
 * inteira) espera a anterior terminar. Dentro da transação o Drizzle usa o
 * cliente da própria transação, que não passa por esta fila.
 */

interface PendingLike<T> extends PromiseLike<T> {
  values(): PromiseLike<unknown>;
}

interface Client {
  unsafe(query: string, params?: unknown[], options?: unknown): PendingLike<unknown>;
  begin(...args: unknown[]): Promise<unknown>;
}

export function serializeQueries<T extends object>(client: T): T {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<R>(task: () => PromiseLike<R>): Promise<R> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const target = client as unknown as Client;

  return new Proxy(client, {
    get(object, property, receiver) {
      if (property === "unsafe") {
        return (query: string, params?: unknown[], options?: unknown) => {
          // Preguiçoso como o original: só executa quando alguém espera o
          // resultado, e `.values()` decide o formato antes disso.
          let started: Promise<unknown> | undefined;
          const run = (values: boolean) =>
            enqueue(() => {
              const pending = target.unsafe(query, params, options);
              return values ? pending.values() : pending;
            });
          return {
            then<A, B>(
              onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
              onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
            ) {
              started ??= run(false);
              return started.then(onFulfilled, onRejected);
            },
            values() {
              return run(true);
            },
          };
        };
      }
      if (property === "begin") {
        return (...args: unknown[]) => enqueue(() => target.begin(...args));
      }
      return Reflect.get(object, property, receiver);
    },
  });
}
