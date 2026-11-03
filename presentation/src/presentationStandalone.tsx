import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PresentationPage } from "./Presentation";
import { PresentationNotesPage } from "./PresentationNotes";
import {
  slides,
  overviewSlide,
  scenariosSlide,
  giftCaseSlide,
  entryMarketSlide,
  anecdoteSlide,
  thanksSlide,
} from "./presentationContent";
import logoSrc from "./assets/mind-harness-logo.png";
import "./presentation.css";

const overviewPosition =
  slides.findIndex((slide) => slide.key === "relationship") + 1;
const standaloneSlides = [
  ...slides.slice(0, overviewPosition),
  overviewSlide,
  ...slides.slice(overviewPosition).flatMap((slide) => {
    if (slide.key === "case-bp") return [giftCaseSlide];
    return slide.key === "case-retention"
      ? [entryMarketSlide, anecdoteSlide]
      : [slide];
  }),
  scenariosSlide,
  thanksSlide,
];

function isNotesView() {
  return (
    location.hash === "#speaker-notes" || location.hash.startsWith("#notes-")
  );
}
function StandaloneApp() {
  const [notes, setNotes] = useState(isNotesView);
  useEffect(() => {
    const changed = () => setNotes(isNotesView());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: "start", behavior: "instant" });
    else window.scrollTo(0, 0);
  }, [notes]);
  return notes ? (
    <PresentationNotesPage slides={standaloneSlides} logoSrc={logoSrc} />
  ) : (
    <PresentationPage slides={standaloneSlides} logoSrc={logoSrc} />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StandaloneApp />
  </React.StrictMode>,
);
