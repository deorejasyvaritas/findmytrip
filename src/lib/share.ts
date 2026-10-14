// Compartir un link: hoja nativa del sistema si existe (celulares), si no copiar al portapapeles.

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export const shareUrl = (path: string) => `${window.location.origin}${path}`;

export async function shareOrCopy(url: string, title: string, text: string): Promise<ShareOutcome> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      // El usuario cerró la hoja: no hacemos nada más.
      if ((err as Error).name === "AbortError") return "cancelled";
      // Otros errores (por ejemplo, el navegador pide un toque nuevo): probamos copiar.
    }
  }
  return copyText(url);
}

export async function copyText(text: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
