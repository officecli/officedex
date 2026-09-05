export const EMBEDDED_PRESENTATION_BASE_PATH = "/presentation";

type RuntimeEnvironment = Record<string, unknown> & {
  BASE_PATH?: string;
  CDN_HOST?: string;
  SLIDES_HOSTS?: string[];
  STATIC_ASSETS_PREFIX?: string;
};

/**
 * Configures the Presentation source bundle for its OfficeDex subdirectory.
 *
 * Presentation's router resolves relative API routes by concatenating them
 * with the first SLIDES_HOSTS entry. Keeping the mount URL first therefore
 * turns an imported `/p/<fileId>` route into `/presentation/p/<fileId>` instead
 * of escaping to OfficeDex's root router.
 */
export function configureEmbeddedPresentationRuntime(
  runtimeEnvironment: RuntimeEnvironment,
  origin: string,
): string {
  const baseUrl = `${origin}${EMBEDDED_PRESENTATION_BASE_PATH}`;
  runtimeEnvironment.BASE_PATH = EMBEDDED_PRESENTATION_BASE_PATH;
  runtimeEnvironment.CDN_HOST = `${baseUrl}/assets`;
  runtimeEnvironment.STATIC_ASSETS_PREFIX = baseUrl;
  runtimeEnvironment.SLIDES_HOSTS = [baseUrl];
  return baseUrl;
}

export function embeddedPresentationDocumentPath(fileId: string): string {
  return `${EMBEDDED_PRESENTATION_BASE_PATH}/p/${encodeURIComponent(fileId)}`;
}
