export function boundaryPressure(text: string, event: string, unresolved: boolean): boolean {
  return event === 'boundary_pressure' || /you owe me|ignore your boundaries|shut up|idiot/i.test(text) ||
    unresolved && /\b(you can tell me now|tell me now|stop being (so )?reserved)\b/i.test(text);
}
