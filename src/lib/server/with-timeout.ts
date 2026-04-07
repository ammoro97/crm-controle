/**
 * Envolve uma Promise com timeout explícito.
 *
 * Se a Promise não resolver dentro de `ms` milissegundos, rejeita com
 * `Error("TIMEOUT:<label>")`. O timer é cancelado imediatamente em caso
 * de resolução ou rejeição da Promise original.
 *
 * Uso:
 *   const result = await withTimeout(supabase.from('t').select('*'), 8000, 'read_leads');
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "op"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`TIMEOUT:${label}`));
    }, ms);

    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}
