export type GoalCommand =
  | { kind: 'open' }
  | { kind: 'edit' }
  | { kind: 'status' }
  | { kind: 'start'; objective: string }

// Pass the raw composer text, before submittedCommand() trims its argument.
export function parseGoalCommand(text: string): GoalCommand | undefined {
  // Consume exactly one separator so `/goal ` + an objective round-trips its
  // indentation, trailing spaces and line breaks. CRLF is one line separator.
  const match = text.trimStart().match(/^[/]goal(?:(?:\r\n|\s)([\s\S]*))?$/i)
  if (!match) return undefined
  const objective = match[1] ?? ''
  const token = objective.trim()
  if (!token) return { kind: 'open' }
  if (token === 'edit' || token === 'status') return { kind: token }
  return { kind: 'start', objective }
}

export function goalEditPrompt(objective: string): string {
  return '/goal ' + objective
}
