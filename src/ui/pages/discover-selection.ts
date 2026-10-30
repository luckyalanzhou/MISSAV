export function shouldClearDiscoveryResults(input: {
  queryChanged: boolean
  appendPage: boolean
  forceRefresh: boolean
  sameListing: boolean
  hasItems: boolean
  hasCategories: boolean
}): boolean {
  const hasResults = input.hasItems || input.hasCategories
  const preserveResults = input.forceRefresh && input.sameListing && hasResults
  return input.queryChanged && !input.appendPage && !preserveResults
}
