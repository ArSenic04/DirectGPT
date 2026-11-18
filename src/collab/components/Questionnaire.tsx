/** Post-task questionnaire: Likert items + raw NASA-TLX. */
import { useState } from 'react';
import { LIKERT_ITEMS, LIKERT_SCALE, TLX_SCALES, isQuestionnaireComplete } from '../../../shared/questionnaire';

interface Props {
  conditionLabel: string;
  onSubmit: (likert: Record<string, number>, tlx: Record<string, number>, comment: string) => void;
}

export function Questionnaire({ conditionLabel, onSubmit }: Props) {
  const [likert, setLikert] = useState<Record<string, number>>({});
  const [tlx, setTlx] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const complete = isQuestionnaireComplete(likert, tlx);
  const values = Array.from({ length: LIKERT_SCALE.max - LIKERT_SCALE.min + 1 }, (_, i) => LIKERT_SCALE.min + i);

  return (
    <div className="cdg-modal-backdrop">
      <div className="cdg-modal" role="dialog" aria-modal="true" aria-labelledby="q-title" data-testid="questionnaire">
        <h2 id="q-title">Post-task questionnaire</h2>
        <p className="cdg-muted">About the interface you just used ({conditionLabel}). Answer individually.</p>
        <h3>Part 1 · How much do you agree?</h3>
        <table className="cdg-likert">
          <thead>
            <tr>
              <th />
              {values.map((v) => (
                <th key={v} className="cdg-likert-head">
                  {v === LIKERT_SCALE.min ? `${v} ${LIKERT_SCALE.minLabel}` : v === LIKERT_SCALE.max ? `${v} ${LIKERT_SCALE.maxLabel}` : v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LIKERT_ITEMS.map((item) => (
              <tr key={item.id} data-testid={`likert-${item.id}`}>
                <td className="cdg-likert-q">{item.text}</td>
                {values.map((v) => (
                  <td key={v} className="cdg-likert-cell">
                    <input
                      type="radio"
                      name={item.id}
                      aria-label={`${item.text}: ${v}`}
                      checked={likert[item.id] === v}
                      onChange={() => setLikert({ ...likert, [item.id]: v })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Part 2 · Workload (NASA-TLX)</h3>
        {TLX_SCALES.map((s) => (
          <div key={s.id} className="cdg-tlx" data-testid={`tlx-${s.id}`}>
            <div>
              <strong>{s.label}</strong> — {s.question}
            </div>
            <div className="cdg-tlx-row">
              <span className="cdg-small cdg-muted">{s.low}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={tlx[s.id] ?? 50}
                aria-label={s.label}
                className={tlx[s.id] === undefined ? 'cdg-range-untouched' : ''}
                onChange={(e) => setTlx({ ...tlx, [s.id]: Number(e.target.value) })}
                onClick={(e) => setTlx({ ...tlx, [s.id]: Number((e.target as HTMLInputElement).value) })}
              />
              <span className="cdg-small cdg-muted">{s.high}</span>
              <span className="cdg-tlx-value">{tlx[s.id] ?? '–'}</span>
            </div>
          </div>
        ))}
        <h3>Part 3 · Comments (optional)</h3>
        <textarea className="cdg-input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="q-comment" />
        <div className="cdg-modal-actions">
          {!complete && <span className="cdg-muted cdg-small">Please answer every item (move each slider at least once).</span>}
          <button className="cdg-btn cdg-btn-primary" disabled={!complete} data-testid="q-submit" onClick={() => onSubmit(likert, tlx, comment.trim())}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
