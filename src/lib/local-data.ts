import { load, save } from "./storage.ts";

// Copia local de los datos de la cuenta. En un navegador compartido no tiene
// que pasar nada de una cuenta a otra: guardamos de quién es la copia y la
// borramos al cerrar sesión o si entra otra persona.

const OWNER_KEY = "fmt.owner";

/** Datos personales guardados en el navegador. Quedan afuera solo preferencias
 *  sin datos de la persona (por ejemplo, la lista de destinos para comparar). */
export const PERSONAL_KEYS = ["fmt.profile", "fmt.packages", "fmt.watchlist", "fmt.chat", "fmt.lastSearch"] as const;

export const localOwner = () => load<string | null>(OWNER_KEY, null);

/** Borra la copia local de la cuenta (al cerrar sesión). */
export function clearLocalData(): void {
  for (const key of [...PERSONAL_KEYS, OWNER_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* sin storage: no hay nada que borrar */
    }
  }
}

/**
 * Se llama apenas se sabe quién inició sesión, antes de leer la copia local.
 * Si la copia es de otra cuenta, se borra: los datos de esta cuenta vuelven del
 * servidor. Una copia sin dueña (de antes de guardarla) se adopta: era de quien
 * usaba este navegador, y borrarla podía perder viajes que no llegaron a subirse.
 */
export function claimLocalData(user: string): void {
  const owner = localOwner();
  if (owner === user) return;
  if (owner != null) clearLocalData();
  save(OWNER_KEY, user);
}
