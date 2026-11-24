import type { Metadata } from 'next';
import Link from 'next/link';
import { AtmosphereCanvas } from '../_home/AtmosphereCanvas';
import { PencilLinearGradient } from '../_home/gradients';
import { HomeIcon, ReactMark, VueMark, ZhinexusMark } from '../_home/icons';
import { StructureWindow, WindowNote } from '../_home/StructureWindow';
import { TitanSculpture } from '../_home/TitanSculpture';
import { TrendWindow } from '../_home/TrendWindow';
import {
  ACTION_SECTION,
  ASSET_SECTION,
  ATMOSPHERE_PRESETS,
  ECOSYSTEM,
  FRAMEWORK_SECTION,
  HERO,
  HOME_FOOTER,
  HOME_NAV,
  PROCESS_SECTION,
} from '../_home/home-content';
import '../_home/home.css';

export const metadata: Metadata = {
  title: 'Zhinexus 组件资产平台',
  description: '企业级图表与组件资产平台。沉淀团队经验，让 Vue 与 React 共享创造力。',
};

const trend = ASSET_SECTION.trend;
const structure = ASSET_SECTION.structure;

export default function PublicIntroPage() {
  return (
    <div className="home-page">
      {/* ---------- 01 导航 ---------- */}
      <header className="home-header">
        <div className="home-shell home-header__inner">
          <Link href="/" className="home-header__brand">
            <ZhinexusMark />
            <span className="home-header__wordmark">{HOME_NAV.brand}</span>
          </Link>
          <nav className="home-header__links" aria-label="介绍页导航">
            {HOME_NAV.links.map((link) =>
              link.href === null ? (
                <span key={link.label} className="home-header__link home-header__link--static">
                  {link.label}
                </span>
              ) : (
                <Link
                  key={link.label}
                  href={link.href}
                  className="home-header__link"
                  aria-current={link.href === '/' ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>
          <Link href={HOME_NAV.cta.href} className="home-header__cta">
            {HOME_NAV.cta.label}
            <HomeIcon name="arrow-up-right" size={18} />
          </Link>
        </div>
        <div className="home-header__rule" />
      </header>

      <main>
        {/* ---------- 02 首屏 ---------- */}
        <section className="home-hero" aria-labelledby="home-hero-title">
          <AtmosphereCanvas mode={ATMOSPHERE_PRESETS[0].mode} />
          <div className="home-hero__glow" />
          <div className="home-hero__art">
            <TitanSculpture />
            <svg className="home-art-leader" viewBox="0 0 700 650" aria-hidden="true" focusable="false" style={{ left: 0, top: 0, width: 700, height: 650 }}>
              <path d="M498 106l100-36h78" stroke="#7A889944" strokeWidth="1" fill="none" />
              <path d="M167 516l-73 54h-39" stroke="#7A889940" strokeWidth="1" fill="none" />
            </svg>
            <span className="home-art-dot" style={{ left: 495.5, top: 103.5, width: 5, height: 5, background: '#AAC5D877' }} />
            <span className="home-art-dot" style={{ left: 164.5, top: 513.5, width: 5, height: 5, background: '#A6C8C680' }} />
            <span className="home-art-note" style={{ left: 98, top: 580, width: 465 }}>
              {HERO.studyMaterial}
            </span>
          </div>
          <p className="home-hero__study">{HERO.studyIndex}</p>
          <div className="home-shell home-hero__body">
            <p className="home-hero__eyebrow">{HERO.eyebrow}</p>
            <h1 className="home-hero__title" id="home-hero-title">
              <span>{HERO.titleLines[0]}</span>
              <span className="home-hero__title-gradient">{HERO.titleLines[1]}</span>
            </h1>
            <p className="home-hero__lede">{HERO.lede}</p>
            <p className="home-hero__sub">{HERO.sub}</p>
            <div className="home-hero__actions">
              <Link href={HERO.primaryCta.href} className="home-button">
                {HERO.primaryCta.label}
                <HomeIcon name="arrow-up-right" size={19} />
              </Link>
              {HERO.secondaryCta.href === null ? (
                <span className="home-link">
                  {HERO.secondaryCta.label}
                  <HomeIcon name="arrow-right" size={17} />
                </span>
              ) : (
                <Link href={HERO.secondaryCta.href} className="home-link">
                  {HERO.secondaryCta.label}
                  <HomeIcon name="arrow-right" size={17} />
                </Link>
              )}
            </div>
            <p className="home-hero__annotation">{HERO.annotation}</p>
          </div>
          <div className="home-hero__rule" />
          <div className="home-hero__foot">
            <span className="home-hero__scroll">
              {HERO.scroll}
              <HomeIcon name="arrow-down" size={13} />
            </span>
            <span>{HERO.principle}</span>
          </div>
        </section>

        {/* ---------- 03 生态横带 ---------- */}
        <section className="home-ecosystem" aria-label="技术生态">
          <div className="home-shell home-ecosystem__grid">
            <div className="home-ecosystem__label">
              <p className="home-ecosystem__index">{ECOSYSTEM.index}</p>
              <p className="home-ecosystem__subtitle">{ECOSYSTEM.subtitle}</p>
            </div>
            <ul className="home-ecosystem__items">
              {ECOSYSTEM.items.map((item) => (
                <li className="home-ecosystem__item" key={item.label}>
                  <p className="home-ecosystem__name">{item.label}</p>
                  <span className="home-ecosystem__dot" style={{ background: item.dot }} />
                </li>
              ))}
            </ul>
          </div>
          <div className="home-section-rule" />
        </section>

        {/* ---------- 04 资产 ---------- */}
        <section className="home-assets" aria-labelledby="home-assets-title">
          <AtmosphereCanvas mode={ATMOSPHERE_PRESETS[1].mode} />
          <div className="home-shell">
            <div className="home-section-head">
              <div>
                <p className="home-section-index">{ASSET_SECTION.index}</p>
                <h2 className="home-section-title" id="home-assets-title">
                  {ASSET_SECTION.title}
                </h2>
              </div>
              <p className="home-section-description">{ASSET_SECTION.description}</p>
            </div>

            <div className="home-windows">
              <figure className="home-window home-window--trend">
                <div className="home-window__frame">
                  <TrendWindow />
                  <WindowNote x={28} y={23} color="#A9BABF" size={10} tracking={1}>
                    {trend.window.code}
                  </WindowNote>
                  <WindowNote x={504} y={23} width={240} align="right" color="#72818D" size={9} tracking={1}>
                    {trend.window.concept}
                  </WindowNote>
                  <WindowNote x={30} y={51} color="#E8F3F2" size={36} tracking={-1.4}>
                    {trend.window.value}
                  </WindowNote>
                  <WindowNote x={150} y={77} color="#8A9CA4" size={11}>
                    {trend.window.valueNote}
                  </WindowNote>
                  <span className="home-window__legend home-window__legend--current">
                    <i className="home-window__swatch home-window__swatch--current" />
                    {trend.window.currentLegend}
                  </span>
                  <span className="home-window__legend home-window__legend--compare">
                    <i className="home-window__swatch home-window__swatch--compare" />
                    {trend.window.compareLegend}
                  </span>
                  <span className="home-window__focus">{trend.window.focusNote}</span>
                  {trend.window.axisLabels.map((label, index) => (
                    <WindowNote key={label} x={52 + index * 123} y={293} color="#7D8B99" size={10} tracking={1}>
                      {label}
                    </WindowNote>
                  ))}
                </div>
              </figure>

              <figure className="home-window home-window--structure">
                <div className="home-window__frame">
                  <StructureWindow />
                  <WindowNote x={27} y={23} color="#B9B7C8" size={10} tracking={1}>
                    {structure.window.code}
                  </WindowNote>
                  <WindowNote x={386} y={23} width={65} align="right" color="#848194" size={9} tracking={1}>
                    {structure.window.concept}
                  </WindowNote>
                  <WindowNote x={28} y={52} color="#DCE0E8" size={18} tracking={0.4}>
                    {structure.window.subtitle}
                  </WindowNote>
                  <WindowNote x={306} y={59} width={146} align="right" color="#9193A5" size={9} tracking={1}>
                    {structure.window.material}
                  </WindowNote>
                  {structure.window.sequenceLabels.map((label, index) => (
                    <WindowNote key={label} x={55 + index * 45} y={293} color="#9196A5" size={10} tracking={0.4}>
                      {label}
                    </WindowNote>
                  ))}
                </div>
              </figure>
            </div>

            <div className="home-assets__captions">
              <div className="home-caption home-caption--trend">
                <h3 className="home-caption__name">{trend.name}</h3>
                <p className="home-caption__summary">{trend.summary}</p>
                <span className="home-caption__frameworks">{trend.frameworks}</span>
              </div>
              <div className="home-caption home-caption--structure">
                <h3 className="home-caption__name">{structure.name}</h3>
                <p className="home-caption__summary">{structure.summary}</p>
                <span className="home-caption__frameworks">{structure.frameworks}</span>
              </div>
            </div>

            <div className="home-assets__browse">
              <Link href="/components">
                {ASSET_SECTION.browseAll}
                <HomeIcon name="arrow-up-right" size={17} />
              </Link>
            </div>
          </div>
          <div className="home-section-rule home-section-rule--assets" />
        </section>

        {/* ---------- 05 原生 ---------- */}
        <section className="home-frameworks" aria-labelledby="home-frameworks-title">
          <AtmosphereCanvas mode={ATMOSPHERE_PRESETS[2].mode} />
          <div className="home-frameworks__glow" />
          <div className="home-shell home-frameworks__grid">
            <div className="home-frameworks__copy">
              <p className="home-section-index home-section-index--iris">{FRAMEWORK_SECTION.index}</p>
              <h2 className="home-section-title" id="home-frameworks-title">
                {FRAMEWORK_SECTION.title}
              </h2>
              <p className="home-frameworks__note">{FRAMEWORK_SECTION.description}</p>
              <p className="home-frameworks__boundary">{FRAMEWORK_SECTION.boundary}</p>
            </div>
            <div className="home-frameworks__stage">
              <svg
                className="home-frameworks__link"
                viewBox="0 0 558 147"
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <PencilLinearGradient
                    id="framework-link"
                    rotation={90}
                    stops={[
                      { color: '#9ABCB06B', position: 0 },
                      { color: '#887EA566', position: 1 },
                    ]}
                  />
                </defs>
                <path
                  d="M178 0h29q20 0 20 22v104q0 21 16 21m136-147h-30q-20 0-20 22v104q0 21-16 21"
                  fill="none"
                  stroke="url(#framework-link)"
                  strokeWidth="1"
                />
              </svg>

              <div className="home-badge">
                <span className="home-badge__glow home-badge__glow--vue" />
                <div className="home-badge__medallion">
                  <span className="home-badge__shell" />
                  <span className="home-badge__core" />
                  <span className="home-badge__mark">
                    <VueMark />
                  </span>
                </div>
                <p className="home-badge__name">{FRAMEWORK_SECTION.badges[0].name}</p>
                <p className="home-badge__note">{FRAMEWORK_SECTION.badges[0].note}</p>
              </div>

              <div className="home-core">
                <div className="home-core__ring">
                  <div className="home-core__glass">
                    <HomeIcon name="layers" size={24} />
                  </div>
                </div>
                <p className="home-core__label">{FRAMEWORK_SECTION.sharedCore.label}</p>
                <p className="home-core__tech">{FRAMEWORK_SECTION.sharedCore.tech}</p>
              </div>

              <div className="home-badge">
                <span className="home-badge__glow home-badge__glow--react" />
                <div className="home-badge__medallion">
                  <span className="home-badge__shell" />
                  <span className="home-badge__core" />
                  <span className="home-badge__mark">
                    <ReactMark />
                  </span>
                </div>
                <p className="home-badge__name">{FRAMEWORK_SECTION.badges[1].name}</p>
                <p className="home-badge__note">{FRAMEWORK_SECTION.badges[1].note}</p>
              </div>
            </div>
          </div>
          <div className="home-section-rule" />
        </section>

        {/* ---------- 06 流程 ---------- */}
        <section className="home-process" aria-labelledby="home-process-title">
          <AtmosphereCanvas mode={ATMOSPHERE_PRESETS[3].mode} />
          <div className="home-process__glow" />
          <div className="home-shell">
            <div className="home-section-head">
              <div>
                <p className="home-section-index">{PROCESS_SECTION.index}</p>
                <h2 className="home-section-title" id="home-process-title">
                  {PROCESS_SECTION.title}
                </h2>
              </div>
              <p className="home-section-description home-process__lede">{PROCESS_SECTION.lede}</p>
            </div>
            <div className="home-process__track">
              <div className="home-process__fiber" />
              <ol className="home-process__steps">
                {PROCESS_SECTION.steps.map((step, index) => {
                  const tone = index % 2 === 0 ? 'teal' : 'iris';
                  return (
                    <li className="home-step" key={step.order}>
                      <p className="home-step__order">
                        {step.order}
                        <HomeIcon className="home-step__icon" name={step.icon} size={18} />
                      </p>
                      <span className={`home-step__node home-step__node--${tone}`}>
                        <span className={`home-step__ring home-step__ring--${tone}`} />
                        <span className={`home-step__pip home-step__pip--${tone}`} />
                      </span>
                      <h3 className="home-step__title">{step.title}</h3>
                      <p className="home-step__description">{step.description}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>

        {/* ---------- 07 行动 ---------- */}
        <section className="home-action" aria-labelledby="home-action-title">
          <AtmosphereCanvas mode={ATMOSPHERE_PRESETS[4].mode} />
          <span className="home-action__glow home-action__glow--teal" />
          <span className="home-action__glow home-action__glow--iris" />
          <div className="home-shell home-action__grid">
            <div>
              <p className="home-hero__eyebrow">{ACTION_SECTION.eyebrow}</p>
              <h2 className="home-action__title" id="home-action-title">
                {ACTION_SECTION.title}
              </h2>
            </div>
            <div className="home-action__side">
              <Link href={ACTION_SECTION.cta.href} className="home-button home-action__button">
                {ACTION_SECTION.cta.label}
                <HomeIcon name="arrow-up-right" size={19} />
              </Link>
              <p className="home-action__note">{ACTION_SECTION.note}</p>
            </div>
          </div>
          <div className="home-action__rule" />
        </section>
      </main>

      {/* ---------- 08 页脚 ---------- */}
      <footer className="home-footer">
        <div className="home-shell">
          <div className="home-footer__top">
            <div className="home-footer__brand">
              <ZhinexusMark />
              <span className="home-footer__wordmark">{HOME_FOOTER.brand}</span>
            </div>
            <p className="home-footer__tagline">{HOME_FOOTER.tagline}</p>
            <nav className="home-footer__links" aria-label="页脚导航">
              {HOME_FOOTER.links.map((link) =>
                link.href === null ? (
                  <span key={link.label} className="home-footer__link home-footer__link--static">
                    {link.label}
                  </span>
                ) : (
                  <Link key={link.label} href={link.href} className="home-footer__link">
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
          </div>
          <div className="home-footer__bottom">
            <span>{HOME_FOOTER.copyright}</span>
            <span className="home-footer__concept">{HOME_FOOTER.concept}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
