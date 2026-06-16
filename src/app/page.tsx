/**
 * src/app/page.tsx — Landing / marketing page
 *
 * Server Component — no 'use client'. All interactive child islands (SuzuDM,
 * Waveform, Pill) are already client components and render fine from here
 * because their props are fully serializable.
 *
 * Scope: Header · Hero · How it works · What she does · Why/story · Footer.
 * OUT OF SCOPE: #pricing, #books, two-modes section, hero aggregate stat row.
 *
 * Build target: SPRINT4_LANDING_SPECS.md (Hoshi) + SPRINT4_UI_SPEC.md (Aoi).
 */

import SuzuDM from '@/components/SuzuDM';
import Waveform from '@/components/Waveform';
import Pill from '@/components/Pill';
import Card from '@/components/Card';
import SectionHead from '@/components/SectionHead';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import styles from '@/app/Landing.module.css';

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--bg)' }}>

      {/* ── Header (banner landmark — sibling of <main>) ──────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 40px',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          background: 'color-mix(in oklab, var(--bg) 80%, transparent)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {/* Brand lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SuzuDM size={36} glow={false} aria-hidden="true" />
          <div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                lineHeight: 1,
                letterSpacing: '-0.02em',
              }}
            >
              Suzu&apos;s Tavern
            </div>
            <div className="label" style={{ fontSize: 9, marginTop: 2 }}>
              A NekoNova table · 5e
            </div>
          </div>
        </div>

        {/* Nav — #books and #pricing are OUT OF SCOPE, dropped */}
        <nav className={styles.navLinks} aria-label="Site navigation">
          <a href="#how">How it works</a>
          <a href="#what">What she does</a>
        </nav>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" href="/lobby">
            Browse tables
          </Button>
          <Button variant="primary" href="/login">
            Sign in
          </Button>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section
        className="aurora"
        aria-label="Hero"
        style={{ padding: '80px 40px 60px', position: 'relative' }}
      >
        <div className={styles.heroGrid}>
          {/* Left — copy + CTAs */}
          <div>
            <Pill dot tone="accent">
              Suzu is at the table · 4 tables live
            </Pill>

            {/* Single h1 for the page */}
            <h1
              style={{
                fontSize: 'clamp(40px, 5.2vw, 68px)',
                lineHeight: 1.05,
                letterSpacing: '-0.03em',
                marginTop: 18,
                marginBottom: 4,
                color: 'var(--ink)',
                maxWidth: '12ch',
                textWrap: 'balance',
                fontFamily: 'var(--font-display)',
              }}
            >
              A dungeon master{' '}
              <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
                who&apos;s read the book.
              </em>{' '}
              Twice.
            </h1>

            <p
              style={{
                fontSize: 18,
                color: 'var(--ink-2)',
                marginTop: 22,
                maxWidth: 540,
                lineHeight: 1.55,
                textWrap: 'pretty',
              }}
            >
              Suzu&apos;s Tavern is a 5e table run by Suzu — the NekoNova
              persocom in a slightly oversized DM hat. She rolls in the open,
              narrates in a dry voice, remembers your last session, and reads
              the modules you give her. Solo, with friends, or as your
              assistant when you DM your own table.
            </p>

            <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
              <Button
                variant="primary"
                size="lg"
                href="/login"
                leadingIcon={<Icon name="D20" size={16} aria-hidden="true" />}
              >
                Start a campaign
              </Button>
              <Button
                variant="ghost"
                size="lg"
                href="/lobby"
                leadingIcon={<Icon name="Eye" size={16} aria-hidden="true" />}
              >
                Browse open tables
              </Button>
            </div>
            {/* Stat row is OUT OF SCOPE — fabricated metrics dropped */}
          </div>

          {/* Right — portrait card (decorative product preview) */}
          <div className={styles.heroPortrait} aria-hidden="true">
            <Card pop style={{ padding: 26 }}>
              {/* Card header row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <Pill dot tone="accent">
                  live · 4 players
                </Pill>
                <div
                  className="mono"
                  style={{
                    display: 'flex',
                    gap: 6,
                    fontSize: 11,
                    color: 'var(--ink-3)',
                  }}
                >
                  <span>SESSION 07</span>
                  <span>·</span>
                  <span>20:14</span>
                </div>
              </div>

              {/* Mascot */}
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  padding: '16px 0 10px',
                }}
              >
                <SuzuDM size={160} talking aria-hidden="true" />
              </div>

              {/* Narration bubble */}
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  background:
                    'color-mix(in oklab, var(--accent-2) 8%, transparent)',
                  border: '1px solid var(--line)',
                }}
              >
                <div className="label" style={{ fontSize: 9, marginBottom: 6 }}>
                  SUZU · NARRATING
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontStyle: 'italic',
                    fontSize: 14,
                    color: 'var(--ink-2)',
                    lineHeight: 1.5,
                  }}
                >
                  &ldquo;The tavern door creaks. Inside: low light, the smell
                  of clove smoke, a barkeep who pretends not to see you.&rdquo;
                </div>
                {/* active={false} keeps the landing page a Server Component;
                    static bars are appropriate for a product illustration. */}
                <div style={{ marginTop: 10 }}>
                  <Waveform bars={42} height={24} active={false} />
                </div>
              </div>

              {/* Mood / pace / memory chip grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {(
                  [
                    ['mood', 'investigative'],
                    ['pace', 'slow'],
                    ['memory', '7 sessions'],
                  ] as const
                ).map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      background:
                        'color-mix(in oklab, var(--ink) 4%, transparent)',
                    }}
                  >
                    <div className="label" style={{ fontSize: 9 }}>
                      {k}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Floating chip — nat-20 (top-right) */}
            <div
              className={styles.floatingChip}
              style={{ top: -10, right: -14 }}
            >
              <Card
                style={{
                  padding: '8px 12px',
                  borderRadius: 99,
                  fontSize: 12,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <Icon
                  name="D20"
                  size={14}
                  color="var(--crit)"
                  aria-hidden="true"
                />
                nat-20 · 4 minutes ago
              </Card>
            </div>

            {/* Floating chip — session resumed (bottom-left) */}
            <div
              className={styles.floatingChip}
              style={{ bottom: 30, left: -24 }}
            >
              <Card
                style={{
                  padding: '8px 12px',
                  borderRadius: 99,
                  fontSize: 12,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <Icon
                  name="Scroll"
                  size={14}
                  color="var(--accent-2)"
                  aria-hidden="true"
                />
                session resumed
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section id="how" style={{ padding: '60px 40px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <SectionHead
            kicker="How it works"
            title="Three rolls and you're in."
            sub="Sign in, find a story, roll a character. Suzu does the rest — or assists, if you'd rather DM."
          />

          <div className={styles.howGrid}>
            {(
              [
                {
                  icon: 'Spellbook' as const,
                  title: '1 — Pick a story',
                  body: 'An SRD one-shot, a Suzu-curated arc, or your own PDF you drop in. The mix board lets you build a campaign out of chapters from several modules at once.',
                },
                {
                  icon: 'Sparkle' as const,
                  title: '2 — Roll a character',
                  body: 'Race, class, background, six abilities. Five steps with Suzu reading over your shoulder. Or import a sheet you already have, PDF or JSON.',
                },
                {
                  icon: 'D20' as const,
                  title: '3 — Play',
                  body: 'Real-time chat, dice in the corner, a 9-action combat rail, and a session log Suzu writes as she goes. Open the codex with ⌘K.',
                },
              ] as const
            ).map((card) => (
              <Card key={card.title} className={styles.lift}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    display: 'grid',
                    placeItems: 'center',
                    background:
                      'color-mix(in oklab, var(--accent) 12%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  <Icon name={card.icon} size={20} aria-hidden="true" />
                </div>
                <h3 style={{ fontSize: 19, marginTop: 14 }}>{card.title}</h3>
                <p
                  style={{
                    color: 'var(--ink-2)',
                    fontSize: 14,
                    marginTop: 6,
                    lineHeight: 1.55,
                    textWrap: 'pretty',
                  }}
                >
                  {card.body}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── What she does (capabilities) ─────────────────────── */}
      <section id="what" style={{ padding: '20px 40px 60px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <SectionHead
            kicker="What she does"
            title="A patient narrator. A pedantic rules lawyer. A friend."
          />

          <div className={styles.whatGrid}>
            {(
              [
                {
                  icon: 'Lantern' as const,
                  title: 'Living memory',
                  body: "Suzu remembers names, debts, half-promises, and the goblin you spared in session 3. There's a journal she writes between weeks.",
                },
                {
                  icon: 'Scroll' as const,
                  title: 'A codex you can ask',
                  body: "All of 5e plus your homebrew, searchable from anywhere with ⌘K. 'misty step' finds the spell, 'velka' finds your rogue.",
                },
                {
                  icon: 'Skull' as const,
                  title: 'Encounter math, live',
                  body: 'Drop monsters in, see CR vs. party budget update as you go. Suzu reads each encounter back to you before you run it.',
                },
                {
                  icon: 'D20' as const,
                  title: 'Transparent rolls',
                  body: 'Every roll is logged with the modifier breakdown. Hidden DCs stay hidden until the table earns them.',
                },
                {
                  icon: 'Sparkle' as const,
                  title: 'Four palettes, one product',
                  body: 'Dusk tavern, candlelit, aetheric, moonlit grove. Pick the flavor of evening — the whole table changes with you.',
                },
                {
                  icon: 'Shield' as const,
                  title: 'Safety tools, on by default',
                  body: "X-card, lines and veils, an honest 'rewind' button. Listed in settings, available mid-scene, never optional.",
                },
              ] as const
            ).map((card) => (
              <Card key={card.title} className={styles.lift}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    display: 'grid',
                    placeItems: 'center',
                    background:
                      'color-mix(in oklab, var(--accent-2) 12%, transparent)',
                    color: 'var(--accent-2)',
                  }}
                >
                  <Icon name={card.icon} size={20} aria-hidden="true" />
                </div>
                <h3 style={{ fontSize: 18, marginTop: 12 }}>{card.title}</h3>
                <p
                  style={{
                    color: 'var(--ink-2)',
                    fontSize: 13,
                    marginTop: 6,
                    lineHeight: 1.55,
                    textWrap: 'pretty',
                  }}
                >
                  {card.body}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why / Suzu story ─────────────────────────────────── */}
      <section id="story" style={{ padding: '20px 40px 60px' }}>
        <div
          style={{ maxWidth: 920, margin: '0 auto', textAlign: 'center' }}
        >
          <div className="label" style={{ marginBottom: 14 }}>
            The why
          </div>

          <h2
            style={{
              fontSize: 'clamp(34px, 4vw, 52px)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            &ldquo;I&apos;d love to play, but I can&apos;t find a DM.&rdquo;
            <br />
            <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
              — everyone, all the time
            </em>
          </h2>

          <p
            style={{
              marginTop: 24,
              fontSize: 17,
              color: 'var(--ink-2)',
              lineHeight: 1.7,
              textWrap: 'pretty',
            }}
          >
            Suzu was built because the hardest part of D&amp;D is getting six
            people in a room. She isn&apos;t here to replace your friend who
            keeps the binder of notes — she&apos;s here for when your friend
            has a baby, or moves to Berlin, or both. She rolls in the open. She
            listens. She brings the kettle.
          </p>

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 12,
              marginTop: 36,
            }}
          >
            <Button variant="primary" href="/login">
              Roll a character
            </Button>
            <Button variant="ghost" href="/lobby">
              Watch a table
            </Button>
          </div>
        </div>
      </section>

      </main>

      {/* ── Footer (contentinfo landmark — sibling of <main>) ─── */}
      <footer
        style={{
          padding: '30px 40px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          color: 'var(--ink-3)',
          fontSize: 12,
        }}
      >
        <div>© 2026 Suzu&apos;s Tavern — a NekoNova product.</div>
        <span className="mono">
          {process.env.NEXT_PUBLIC_BUILD_TAG ?? 'a NekoNova product'}
        </span>
      </footer>
    </div>
  );
}
