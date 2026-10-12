/** Reserved by office.modify for private Review/Apply input. */
export function isInternalProposal(path: string): boolean {
  return /(?:^|[\\/])\.officedex-proposal-[^\\/]+[\\/]/.test(path);
}
