import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Image, Input, Result, Segmented, Tag } from 'antd';
import { ArrowLeftOutlined, FileTextOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { useMediaQuery } from '../../hooks/useMedia';
import { GUIDES, SECTIONS, getGuide, getSection, guidesOf, searchGuides, shotSrc } from './guides';
import type { Guide, GuideStep, SectionKey } from './guides';
import './help.css';

type Variant = 'mobile' | 'desktop';
const isSectionKey = (v: string | null): v is SectionKey => !!v && SECTIONS.some((s) => s.key === v);

/** /help → index with search + section chips; /help/:slug → one guide. */
export default function HelpPage() {
  const { slug } = useParams<{ slug?: string }>();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [slug]);
  if (!slug) return <HelpIndex />;
  const guide = getGuide(slug);
  if (!guide) return <NotFound slug={slug} />;
  return <GuideView key={guide.slug} guide={guide} />;
}

// ------------------------------------------------------------------ index

function HelpIndex() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const section = isSectionKey(sp.get('section')) ? (sp.get('section') as SectionKey) : null;
  const update = (next: { q?: string; section?: SectionKey | null }) => {
    const p = new URLSearchParams(sp);
    if (next.q !== undefined) { if (next.q) p.set('q', next.q); else p.delete('q'); }
    if (next.section !== undefined) { if (next.section) p.set('section', next.section); else p.delete('section'); }
    setSp(p, { replace: true });
  };
  const results = useMemo(() => searchGuides(q, section), [q, section]);
  const filtering = q.trim().length > 0 || !!section;

  return (
    <div className="hp">
      <div className="hp-head">
        <h1 className="kv-page-title">Hướng dẫn sử dụng</h1>
        <p className="hp-lead">Từng bước làm việc với phần mềm, kèm ảnh màn hình trên điện thoại và máy tính. Gõ từ khóa (không cần dấu) hoặc chọn một chuyên mục.</p>
      </div>
      <div className="hp-search">
        <Input size="large" allowClear prefix={<SearchOutlined />} placeholder="Tìm hướng dẫn: bán hàng, trả hàng, kiểm kho, phiếu thu…" value={q} onChange={(e) => update({ q: e.target.value })} inputMode="search" aria-label="Tìm hướng dẫn" />
      </div>
      <div className="hp-chips" role="tablist" aria-label="Chuyên mục">
        <span role="tab" aria-selected={!section} className={`hp-chip${!section ? ' on' : ''}`} onClick={() => update({ section: null })}>Tất cả</span>
        {SECTIONS.map((s) => <span key={s.key} role="tab" aria-selected={section === s.key} className={`hp-chip${section === s.key ? ' on' : ''}`} onClick={() => update({ section: section === s.key ? null : s.key })}>{s.title}</span>)}
      </div>

      {filtering ? (
        <>
          <div className="hp-count">{results.length} hướng dẫn{q.trim() ? ` cho “${q.trim()}”` : ''}{section ? ` trong ${getSection(section).title}` : ''}</div>
          {results.length === 0 ? (
            <div className="hp-empty"><Empty description="Không tìm thấy hướng dẫn phù hợp">
              <Button onClick={() => update({ q: '', section: null })}>Xem tất cả</Button>
            </Empty></div>
          ) : (
            <div className="hp-cards">{results.map((g) => <GuideCard key={g.slug} guide={g} showSection />)}</div>
          )}
        </>
      ) : (
        <>
          <div className="hp-count">{GUIDES.length} hướng dẫn · {SECTIONS.length} chuyên mục</div>
          {SECTIONS.map((s) => {
            const list = guidesOf(s.key);
            return (
              <section className="hp-section" key={s.key} id={s.key}>
                <div className="hp-section-head"><h2>{s.title}</h2><span className="n">{list.length} hướng dẫn</span></div>
                <p className="hp-section-blurb">{s.blurb}</p>
                <div className="hp-cards">{list.map((g) => <GuideCard key={g.slug} guide={g} />)}</div>
              </section>
            );
          })}
        </>
      )}
      <div className="hp-foot">Không thấy điều bạn cần? Hãy thử từ khóa khác hoặc hỏi người quản lý cửa hàng.</div>
    </div>
  );
}

function GuideCard({ guide, showSection }: { guide: Guide; showSection?: boolean }) {
  const shots = guide.steps.filter((s) => s.shot).length;
  return (
    <Link to={`/help/${guide.slug}`} className="hp-card">
      <div className="t"><FileTextOutlined /><span>{guide.title}</span></div>
      <div className="w">{guide.when}</div>
      <div className="m">
        {showSection && <span className="sec">{getSection(guide.section).title}</span>}
        <span>{guide.steps.length} bước</span>
        {shots > 0 && <span>{shots} ảnh</span>}
      </div>
    </Link>
  );
}

// ------------------------------------------------------------------ guide

function GuideView({ guide }: { guide: Guide }) {
  const section = getSection(guide.section);
  const siblings = guidesOf(guide.section);
  const idx = siblings.findIndex((g) => g.slug === guide.slug);
  const prev = idx > 0 ? siblings[idx - 1] : undefined;
  const next = idx < siblings.length - 1 ? siblings[idx + 1] : undefined;
  const wide = useMediaQuery('(min-width: 992px)');
  // phone image on narrow screens, desktop image on wide screens – until the reader toggles
  const [choice, setChoice] = useState<Variant | null>(null);
  const variant: Variant = choice ?? (wide ? 'desktop' : 'mobile');
  const related = (guide.related ?? []).map((s) => getGuide(s)).filter((g): g is Guide => !!g && g.slug !== guide.slug);

  return (
    <div className="hp">
      <div className="hp-back">
        <Link to={`/help?section=${guide.section}`}><ArrowLeftOutlined /> Hướng dẫn</Link>
        <span className="crumb">/ {section.title}</span>
        <span className="spacer" />
      </div>

      <div className="hp-guide">
        <aside className="hp-toc" aria-label="Mục lục">
          <h3>{section.title}</h3>
          <ul>{siblings.map((g) => <li key={g.slug} className={g.slug === guide.slug ? 'on' : ''}><Link to={`/help/${g.slug}`}>{g.title}</Link></li>)}</ul>
          <h3>Trong bài này</h3>
          <ul className="sub">
            <li><a href="#hp-when">Dùng khi nào</a></li>
            <li><a href="#hp-steps">Các bước ({guide.steps.length})</a></li>
            {guide.notes?.length ? <li><a href="#hp-notes">Lưu ý</a></li> : null}
            {related.length ? <li><a href="#hp-related">Xem thêm</a></li> : null}
          </ul>
          <h3>Chuyên mục khác</h3>
          <ul className="sub">{SECTIONS.filter((s) => s.key !== guide.section).map((s) => <li key={s.key}><Link to={`/help?section=${s.key}`}>{s.title}</Link></li>)}</ul>
        </aside>

        <article className="hp-article">
          <div className="hp-sec">{section.title}</div>
          <h1>{guide.title}</h1>
          <div className="hp-meta" id="hp-when">
            <div><span className="k">Dùng khi nào:</span>{guide.when}</div>
            <div>
              <span className="k">Quyền cần có:</span>
              <div className="hp-perms">{guide.perms.map((p) => <Tag key={p} color="blue">{p}</Tag>)}</div>
            </div>
          </div>

          <h2 className="hp-h2" id="hp-steps">Các bước thực hiện</h2>
          <ol className="hp-steps">
            {guide.steps.map((s, i) => <StepItem key={i} step={s} variant={variant} onVariant={setChoice} />)}
          </ol>

          {guide.notes?.length ? (
            <div className="hp-notes" id="hp-notes">
              <h2 className="hp-h2">Lưu ý</h2>
              <Alert type="warning" showIcon message={<ul>{guide.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>} />
            </div>
          ) : null}

          {related.length ? (
            <div id="hp-related">
              <h2 className="hp-h2">Xem thêm</h2>
              <div className="hp-related">{related.map((g) => <Link key={g.slug} to={`/help/${g.slug}`}>{g.title}</Link>)}</div>
            </div>
          ) : null}

          <nav className="hp-nav" aria-label="Bài trước / bài sau">
            {prev ? <Link to={`/help/${prev.slug}`} className="prev"><div className="lbl"><LeftOutlined /> Bài trước</div><div className="ttl">{prev.title}</div></Link> : <span className="ph" />}
            {next ? <Link to={`/help/${next.slug}`} className="next"><div className="lbl">Bài sau <RightOutlined /></div><div className="ttl">{next.title}</div></Link> : <span className="ph" />}
          </nav>
        </article>
      </div>
    </div>
  );
}

function StepItem({ step, variant, onVariant }: { step: GuideStep; variant: Variant; onVariant: (v: Variant) => void }) {
  return (
    <li className="hp-step">
      <div className="txt">{step.text}</div>
      {step.note && <div className="note">{step.note}</div>}
      {step.shot && <ShotFigure shot={step.shot} caption={step.caption} variant={variant} onVariant={onVariant} />}
    </li>
  );
}

/** One screenshot with a phone / computer toggle and tap-to-enlarge. A missing variant falls back to the other one; the figure hides only when neither file exists. */
function ShotFigure({ shot, caption, variant, onVariant }: { shot: string; caption?: string; variant: Variant; onVariant: (v: Variant) => void }) {
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const other: Variant = variant === 'mobile' ? 'desktop' : 'mobile';
  const shown: Variant | null = !missing[shotSrc(shot, variant)] ? variant : !missing[shotSrc(shot, other)] ? other : null;
  if (!shown) return null;
  const src = shotSrc(shot, shown);
  return (
    <figure className="hp-fig">
      <div className="hp-fig-bar">
        <span className="cap">{caption ?? 'Ảnh màn hình'}{shown !== variant ? ` (chưa có ảnh ${variant === 'mobile' ? 'điện thoại' : 'máy tính'})` : ''}</span>
        <Segmented size="small" value={variant} onChange={(v) => onVariant(v as Variant)} options={[{ label: 'Điện thoại', value: 'mobile' }, { label: 'Máy tính', value: 'desktop' }]} />
      </div>
      <div className={`hp-fig-img ${shown}`}>
        <Image key={src} src={src} alt={caption ?? shot} loading="lazy" preview={{ mask: 'Phóng to' }} onError={() => setMissing((m) => ({ ...m, [src]: true }))} />
      </div>
      <div className="hp-fig-hint">Chạm vào ảnh để phóng to</div>
    </figure>
  );
}

function NotFound({ slug }: { slug: string }) {
  const suggestions = useMemo(() => searchGuides(slug.replace(/-/g, ' ')).slice(0, 5), [slug]);
  return (
    <div className="hp">
      <Result
        status="404"
        title="Không tìm thấy hướng dẫn"
        subTitle={`Không có bài hướng dẫn nào với địa chỉ “${slug}”. Bài có thể đã được đổi tên.`}
        extra={<Link to="/help"><Button type="primary" icon={<ArrowLeftOutlined />}>Về trang hướng dẫn</Button></Link>}
      />
      {suggestions.length > 0 && (
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div className="hp-h2">Có thể bạn đang tìm</div>
          <div className="hp-cards">{suggestions.map((g) => <GuideCard key={g.slug} guide={g} showSection />)}</div>
        </div>
      )}
    </div>
  );
}
