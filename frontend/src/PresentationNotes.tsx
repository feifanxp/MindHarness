import { useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { slides } from './presentationContent';

const chapters = [...new Set(slides.map(slide => slide.chapter))];

export function PresentationNotesPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const previousLanguage = document.documentElement.lang;
    document.title = 'Mind Harness — 讲稿';
    document.documentElement.lang = 'zh-CN';
    return () => {
      document.title = previousTitle;
      document.documentElement.lang = previousLanguage;
    };
  }, []);

  return (
    <div className="mh-presentation mh-notes-page" lang="zh-CN">
      <header className="mh-notes-header">
        <a className="mh-brand" href="#notes-top">
          <span className="mh-brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>MIND HARNESS / 讲稿</span>
        </a>
        <a
          className="mh-notes-open-deck"
          href="/presentation"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开演示（新标签页）
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>
      <div className="mh-notes-layout">
        <nav className="mh-notes-toc" aria-label="讲稿目录">
          {chapters.map(chapter => (
            <div key={chapter}>
              <p>{chapter}</p>
              <ol>
                {slides.map(
                  (slide, index) =>
                    slide.chapter === chapter && (
                      <li key={slide.key}>
                        <a href={'#notes-' + slide.key}>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          {slide.label}
                        </a>
                      </li>
                    )
                )}
              </ol>
            </div>
          ))}
        </nav>
        <main className="mh-notes-main" id="notes-top">
          <div className="mh-notes-intro">
            <span>V2.0 / 共 {slides.length} 页</span>
            <h1>Mind Harness 讲稿</h1>
            <p>与演示页码一一对应，过渡语单独列出。</p>
          </div>
          {slides.map((slide, index) => (
            <section
              className="mh-notes-section"
              id={'notes-' + slide.key}
              aria-labelledby={'notes-title-' + slide.key}
              key={slide.key}
            >
              <div className="mh-slide-kicker">
                第 {index + 1} 页 / {slide.chapter}
              </div>
              <h2 id={'notes-title-' + slide.key}>{slide.title}</h2>
              <div className="mh-notes-copy">
                {slide.notes.split(/\n\n+/).map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>{paragraph}</p>
                ))}
              </div>
              {slide.transition && (
                <div className="mh-notes-transition">
                  <h3>过渡</h3>
                  <p>{slide.transition}</p>
                </div>
              )}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
