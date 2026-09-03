export function usesPresentationCompatibilityProtocol(search: string) {
  const query = new URLSearchParams(search);
  return query.get("officedexEmbed") === "1" && Boolean(query.get("channel"));
}
