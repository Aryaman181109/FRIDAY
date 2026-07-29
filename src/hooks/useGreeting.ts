const GREETINGS = {
  morning: "Good Morning",
  afternoon: "Good Afternoon",
  evening: "Good Evening",
} as const;

function getGreetingForHour(hour: number): string {
  if (hour < 12) return GREETINGS.morning;
  if (hour < 18) return GREETINGS.afternoon;
  return GREETINGS.evening;
}

export function useGreeting(name: string): string {
  const greeting = getGreetingForHour(new Date().getHours());
  return `${greeting}, ${name}.`;
}
