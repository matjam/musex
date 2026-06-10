import { useEffect, useState } from "react";

/** Whimsical boot status lines, cycled while the session restores. None of
 *  them are true. All of them are necessary. */
const SPLASH_LINES = [
  "Reticulating splines…",
  "Warming up the tubes…",
  "Polishing the vinyl…",
  "Aligning the tonearm…",
  "Counting beats per minute…",
  "Untangling headphone cables…",
  "Dusting off the B-sides…",
  "Calibrating the gapless gaps…",
  "Consulting the liner notes…",
  "Rewinding the tape…",
  "Adjusting the EQ by vibes…",
  "Negotiating with the shuffle algorithm…",
  "Blowing into the cartridge…",
  "Re-alphabetizing the record crate…",
];

export function SplashScreen() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * SPLASH_LINES.length));

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % SPLASH_LINES.length), 1200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="signin-screen">
      <div className="splash-logo brand">
        mus<span>ex</span>
      </div>
      {/* keyed so each line re-runs the fade-in */}
      <div className="splash-line" key={index}>
        {SPLASH_LINES[index]}
      </div>
    </div>
  );
}
