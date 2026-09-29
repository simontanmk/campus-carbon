export function weekHeadline(w: { meals_week: number; low_carbon_meals_week: number }): string {
  const { meals_week: meals, low_carbon_meals_week: low } = w;
  if (meals === 0) return "Scan the stall's code after your next meal to start your week.";
  if (meals === 1 && low === 1) return "Your one meal this week was low-carbon.";
  if (low === meals) return `All ${meals} of your meals this week were low-carbon.`;
  const noun = meals === 1 ? "meal" : "meals";
  const verb = low === 1 || meals === 1 ? "was" : "were";
  return `${low} of your ${meals} ${noun} this week ${verb} low-carbon.`;
}

export function shortName(name: string): string {
  const m = /^Economy rice: (.+)$/.exec(name);
  return m ? `${m[1]} economy rice` : name;
}

const WORDS = ["", "", "twice", "three times", "four times", "five times", "six times", "seven times", "eight times", "nine times", "ten times"];

export function factHeadline(f: { high: { name: string; kg: number }; low: { name: string; kg: number } }): string {
  const n = Math.round(f.high.kg / f.low.kg);
  const ratio = n <= 10 ? WORDS[n] : `${n}×`;
  const low = shortName(f.low.name);
  return `${shortName(f.high.name)} has about ${ratio} the footprint of ${low.charAt(0).toLowerCase()}${low.slice(1)}.`;
}
