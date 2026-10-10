"""Local PM workspace. Analysis and persistence are provided by backend services."""
import os
import sys
import sqlite3
from collections import Counter
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pandas as pd
import streamlit as st
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ui import styles, header, badge, quote, notes, portfolio
from src.ai.db import (list_requirements, get_requirement, get_linked_evidence,
                       audit_history, revise_requirement, connect)
from src.ai.scoring import WEIGHTS
from src.copilot import runs, run_data, load_inventory, scope_warnings, analyze, portfolio_export
from src.ai.adapter import adapt_feedback
from src.data.loader import DataRepository

st.set_page_config(page_title='BMW | Requirements Copilot', page_icon=':material/directions_car:', layout='wide')
DB = Path(os.getenv('BMW_DB_PATH', str(ROOT / 'data/local/copilot.sqlite3')))
styles()


def open_portfolio():
    st.session_state['workspace_page'] = 'Requirements portfolio'


try:
    all_runs = runs(DB)
except (sqlite3.Error, OSError, ValueError):
    st.error('The local workspace could not be opened. Check BMW_DB_PATH, database permissions and available disk space, then reload.')
    st.stop()
with st.sidebar:
    st.markdown('## BMW')
    st.markdown('**Requirements Copilot**')
    st.caption('PRODUCT INTELLIGENCE')
    st.divider()
    vehicle = st.selectbox('Vehicle', ['F70', 'G60', 'G70'])
    market = st.selectbox('Market', ['GB', 'DE', 'FR', 'JP', 'EU', 'US', 'CN'])
    page = st.radio('Workspace', ['Executive dashboard', 'Data & analysis', 'Findings explorer',
                                  'Requirements portfolio', 'Evaluation & export'], key='workspace_page')
    eligible = [r for r in all_runs if r['settings'].get('vehicle', 'F70') == vehicle
                and r['settings'].get('market', r['settings'].get('country_filter')) in (None, market)]
    run_id = st.selectbox('Persisted analysis', [r['run_id'] for r in eligible],
                          format_func=lambda x: next(f"{r['settings'].get('mode')} · {x}" for r in eligible if r['run_id'] == x)) if eligible else None
    st.caption('Demo identities are unauthenticated. Decisions are attributed, not authenticated.')
    st.caption('Local workspace · no official BMW endorsement')

try:
    data = run_data(DB, run_id) if run_id else {'sources': [], 'findings': [], 'clusters': []}
    requirements = [r for r in list_requirements(DB) if r['run_id'] == run_id
                    and r.get('vehicle_code') == vehicle and r.get('market') in (None, market)]
except (sqlite3.Error, OSError, ValueError, KeyError):
    header(page, vehicle, market)
    st.error('This analysis could not be loaded. Select another persisted analysis or check the local run files and database.')
    st.stop()
selected_run = next((r for r in all_runs if r['run_id'] == run_id), None)
header(page, vehicle, market)
if st.session_state.get("decision_notice"):
    st.success(st.session_state.pop("decision_notice"))

if selected_run and selected_run['settings'].get('mode') in ('synthetic', 'simulated'):
    st.info('Synthetic demonstration. Fictional records exercise the workflow and do not establish BMW customer needs.')


def chart_counts(items, key, title):
    counts = Counter(str(x.get(key) or 'Unknown') for x in items)
    st.markdown(f'**{title}**')
    if counts:
        frame = pd.DataFrame([{'Label': k.replace('_', ' ').title(), 'Count': v} for k, v in counts.most_common()])
        st.bar_chart(frame, x='Label', y='Count', horizontal=True, color='#2875bb', height=220)
    else:
        st.caption('No analyzed records yet.')


def source_panel(source):
    st.caption(f"Source {source.get('source_id')} · {source.get('source_file', 'Unknown file')}")
    st.write('Original location:', source.get('source_location') or source.get('source_ref') or
             source.get('source_cell') or source.get('source_rows') or 'Not recorded')
    text = source.get('text', source.get('text_original'))
    if text:
        quote(text)
    st.write('Scope:', source.get('vehicle', source.get('vehicle_code')), DataRepository.market(source))
    with st.expander('Full local source record'):
        st.json(source)


def requirement_table(items):
    return [{'ID': r['requirement_id'], 'Proposal': r['description'], 'Category': r['category'],
             'Market': r.get('market'), 'Status': r['status'].replace('_', ' ').title(),
             'Priority': r.get('priority_assessment', {}).get('priority', 'unscored').title(),
             'Score': r.get('priority_assessment', {}).get('score'),
             'Confidence': r.get('evidence_confidence', r.get('evidence_level')),
             'Findings': len(r.get('linked_finding_ids', [])), 'Conflicts': len(r.get('conflict_ids', [])),
             'Updated': r.get('updated_at', r.get('created_at')), 'Version': r['version']} for r in items]


if page == 'Executive dashboard':
    if not run_id:
        st.info('Begin in Data & analysis: inspect local sources or run the offline synthetic demonstration.')
    counts = Counter(r['status'] for r in requirements)
    feedback = {r['source_id'] for r in data['sources'] if 'text' in r or r.get('record_type') == 'customer_feedback'}
    for c, (label, value) in zip(st.columns(4), [
            ('Requirements', len(requirements)), ('Awaiting PM review', counts['pending'] + counts['under_review']),
            ('Customer findings', len(data['findings'])), ('Approved', counts['approved'])]):
        c.metric(label, value)
    st.caption(f"{len(feedback)} feedback records / {len(data['clusters'])} need clusters / {counts['rejected']} rejected / {counts['postponed']} postponed")
    st.subheader('PM attention')
    attention = [r for r in requirements if r['status'] in ('pending', 'under_review') or r.get('conflict_ids')]
    if attention:
        portfolio(requirement_table(sorted(attention, key=lambda r: len(r.get('conflict_ids', [])), reverse=True)[:5]))
        st.button('Review requirements', icon=':material/arrow_forward:', on_click=open_portfolio)
    else:
        st.success('No outstanding reviews in the selected portfolio.')
    st.caption('Persisted sources: ' + ', '.join(sorted({r.get('record_type', r.get('source_type', 'feedback')) for r in data['sources']})))
    for warning in scope_warnings(data['sources'], market):
        st.warning(warning)
    if selected_run and selected_run['summary'].get('conflicts'):
        st.warning('Potential source conflicts need PM review. Inspect requirement uncertainty panels.')
    if selected_run and selected_run['summary'].get('validation_errors'):
        st.warning('Analysis contains validation issues. Inspect the run report before decisions.')
    with st.container(border=True):
        views = st.tabs(['Customer signals', 'Portfolio health', 'Recurring needs'])
        with views[0]:
            c1, c2 = st.columns(2)
            with c1:
                chart_counts(data['findings'], 'category', 'Findings by category')
            with c2:
                chart_counts(data['findings'], 'finding_type', 'Signal distribution')
        with views[1]:
            c1, c2 = st.columns(2)
            with c1:
                chart_counts(requirements, 'status', 'Decision status')
            with c2:
                chart_counts(requirements, 'evidence_confidence', 'Evidence confidence')
            chart_counts([r.get('priority_assessment', {}) for r in requirements], 'priority', 'Priority distribution')
        with views[2]:
            if data['clusters']:
                st.dataframe(sorted(data['clusters'], key=lambda c: c.get('supporting_record_count', 0), reverse=True), width='stretch', hide_index=True)
            else:
                st.caption('Customer need clusters appear after analysis.')
    st.subheader('Highest priority proposals')
    ranked = sorted(requirements, key=lambda r: r.get('priority_assessment', {}).get('score') or -1, reverse=True)
    portfolio(requirement_table(ranked[:5]))
    st.caption('Open Requirements portfolio to inspect evidence and decide. Unscored proposals await PM input.')

elif page == 'Data & analysis':
    st.write('Inspect → preview → analyze → validate evidence → score → human decision → export')
    try:
        repo = load_inventory(ROOT / 'data/processed')
    except (ValueError, OSError):
        repo = DataRepository()
        st.error('Local normalized inventory could not be loaded. Check duplicate IDs and file formats locally.')
    local = [r for r in repo.records if r.get('vehicle_code', r.get('vehicle')) == vehicle]
    if local and not repo.load_feedback(vehicle, market):
        st.warning(f'No customer feedback covers {vehicle} / {market}. Other markets must not be treated as local evidence.')
    for warning in scope_warnings(local, market):
        st.warning(warning)
    with st.expander('Source inventory quality report'):
        st.json(repo.generate_data_quality_report(vehicle))
    kinds = sorted({r.get('record_type') for r in local if r.get('record_type')})
    if kinds:
        kind = st.selectbox('Dataset', kinds)
        exact = st.checkbox('Show only selected market', value=True)
        rows = [r for r in local if r.get('record_type') == kind and (not exact or DataRepository.market(r) == market)]
        category_filter = st.text_input('Category / topic contains')
        if category_filter:
            rows = [r for r in rows if category_filter.casefold() in str(r.get('category', r.get('annotations', r.get('metric_name', '')))).casefold()]
        st.dataframe(rows, width='stretch', hide_index=True)
        if kind == 'sales_volume' and rows:
            observed = [r for r in rows if r.get('value_class') in ('historical', 'historical_observation', 'observed', 'actual')]
            if observed and all('year' in r and 'volume' in r for r in observed):
                st.line_chart(pd.DataFrame(observed).pivot_table(index='year', columns='market_code', values='volume', aggfunc='sum'))
            else:
                st.caption('Sales table shown as source context. No historical trend is inferred from values with unspecified or forecast classification.')
        if rows:
            sid = st.selectbox('Inspect original source', [r['source_id'] for r in rows])
            source_panel(next(r for r in rows if r['source_id'] == sid))
    else:
        st.info('No normalized sources for this vehicle. The synthetic workflow remains available.')
    st.subheader('Analysis preview')
    mode = st.selectbox('Processing mode', ['synthetic', 'live'])
    limit = st.number_input('Maximum real feedback records', min_value=1, max_value=500, value=20)
    model = st.text_input('Live model', value=os.getenv('OPENAI_MODEL', 'gpt-5.6-luna'))
    records = [adapt_feedback(r) for r in repo.load_feedback(vehicle, market)[:int(limit)]]
    refs = [r for r in local if r.get('record_type') != 'customer_feedback']
    st.write({'vehicle': vehicle, 'market': market, 'records': 3 if mode == 'synthetic' else len(records),
              'model': 'offline deterministic fixture' if mode == 'synthetic' else model,
              'external_API_call': mode == 'live', 'references': 0 if mode == 'synthetic' else len(refs)})
    authorized = st.checkbox('I have authorization to send selected confidential feedback and reference records to OpenAI.', value=False) if mode == 'live' else False
    if st.button('Run analysis', type='primary', disabled=mode == 'live' and (not authorized or not records)):
        try:
            with st.spinner('Extracting findings, grouping needs and validating proposals…'):
                new_id = analyze(DB, vehicle=vehicle, market=market, mode=mode, records=records,
                                 references=refs, model=model, authorized=authorized)
            st.session_state['analysis_notice'] = f'Analysis saved: {new_id}. Open findings or requirements.'
            st.rerun()
        except Exception:
            st.error('Analysis failed. Check credentials, model access and local source validity. No automatic approval occurred.')
    if st.session_state.get('analysis_notice'):
        st.success(st.session_state['analysis_notice'])
    if selected_run:
        with st.expander('Persisted run report'):
            st.json(selected_run)

elif page == 'Findings explorer':
    findings = data['findings']
    if not findings:
        st.info('No findings. Run or select an analysis in Data & analysis.')
    else:
        c1, c2 = st.columns(2)
        category = c1.selectbox('Category', ['All'] + sorted({f['category'] for f in findings}))
        kind = c2.selectbox('Finding type', ['All'] + sorted({f['finding_type'] for f in findings}))
        filtered = [f for f in findings if (category == 'All' or f['category'] == category) and (kind == 'All' or f['finding_type'] == kind)]
        st.dataframe([{'ID': f['finding_id'], 'Type': f['finding_type'], 'Category': f['category'], 'Summary': f['summary'],
                       'Vehicle': f['source_reference'].get('vehicle'), 'Market': f['source_reference'].get('market'),
                       'Supporting records': 1, 'Quote validated': f['evidence_valid'], 'Review': f['needs_review']} for f in filtered], hide_index=True, width='stretch')
        if filtered:
            fid = st.selectbox('Open finding', [f['finding_id'] for f in filtered])
            f = next(f for f in filtered if f['finding_id'] == fid)
            st.subheader(f['summary'])
            st.caption('AI interpretation. Quote validation verifies provenance, not representativeness.')
            quote(f['evidence_quote'], f['evidence_valid'])
            source_panel(next((s for s in data['sources'] if s['source_id'] == f['source_id']), f['source_reference']))
            st.write('Uncertainty:', f.get('uncertainties', []))
            for cluster in data['clusters']:
                if fid in cluster['finding_ids']:
                    st.write('Need cluster:', cluster)
                    st.write('Related findings:', [x['summary'] for x in findings if x['finding_id'] in cluster['finding_ids'] and x['finding_id'] != fid])
            for link in selected_run['summary'].get('evidence_links', []):
                if link['finding_id'] == fid:
                    st.write('Cross-source relation:', link)
                    s = next((s for s in data['sources'] if s['source_id'] == link['source_id']), None)
                    if s:
                        source_panel(s)

elif page == 'Requirements portfolio':
    if not requirements:
        st.info('No proposals in this scope. Start an analysis in Data & analysis.')
    else:
        cols = st.columns(4)
        category = cols[0].selectbox('Category', ['All'] + sorted({r['category'] for r in requirements}))
        status = cols[1].selectbox('Decision status', ['All', 'pending', 'under_review', 'approved', 'rejected', 'postponed'])
        confidence = cols[2].selectbox('Evidence confidence', ['All'] + sorted({r.get('evidence_confidence', r['evidence_level']) for r in requirements}))
        priority = cols[3].selectbox('Priority', ['All', 'unscored', 'high', 'medium', 'low'])
        search = st.text_input('Search requirements', placeholder='Search proposal wording or requirement ID', icon=':material/search:')
        filtered = [r for r in requirements if (not search or search.casefold() in (r['description'] + r['requirement_id']).casefold()) and (category == 'All' or r['category'] == category) and
                    (status == 'All' or r['status'] == status) and
                    (confidence == 'All' or r.get('evidence_confidence', r['evidence_level']) == confidence) and
                    (priority == 'All' or r.get('priority_assessment', {}).get('priority', 'unscored') == priority)]
        sort = st.selectbox('Sort by', ['Priority score', 'Supporting source count', 'Last modified'])
        filtered.sort(key=lambda r: (r.get('priority_assessment', {}).get('score') if r.get('priority_assessment', {}).get('score') is not None else -1) if sort == 'Priority score' else
                      len(r.get('linked_source_ids', [])) if sort == 'Supporting source count' else r.get('updated_at', r.get('created_at', '')), reverse=True)
        st.caption(f'{len(filtered)} of {len(requirements)} requirements in the selected scope')
        if filtered:
            portfolio(requirement_table(filtered))
        if not filtered:
            st.info('No requirements match these filters.')
        else:
            req_id = st.selectbox('Open requirement', [r['requirement_id'] for r in filtered],
                                  format_func=lambda x: next(r['description'] for r in filtered if r['requirement_id'] == x))
            req = get_requirement(req_id, DB)
            assessment = req.get('priority_assessment', {})
            evidence = get_linked_evidence(req_id, DB)
            st.divider()
            st.caption('REQUIREMENT DECISION WORKSPACE')
            st.subheader(req['description'])
            st.markdown(badge(req['status']) + badge(assessment.get('priority', 'unscored')) + badge(req['category']), unsafe_allow_html=True)
            st.caption(f"{req_id} · {req['status'].replace('pending', 'proposed')} · version {req['version']} · {req.get('planning_horizon', '3–5 years')}")
            cols = st.columns(3)
            cols[0].metric('Priority / 100', assessment.get('score') if assessment.get('score') is not None else 'Unscored')
            cols[1].metric('Evidence confidence', req.get('evidence_confidence', req['evidence_level']).replace('_', ' '))
            cols[2].metric('Unresolved conflicts', len(req.get('conflict_ids', [])))
            tabs = st.tabs(['Overview', 'Supporting evidence', 'Uncertainty & conflicts', 'Prioritization', 'PM decision', 'Decision history'])
            with tabs[0]:
                st.write('Customer-facing proposal:', req['description'])
                st.write('Category and scope:', req['category'], req.get('vehicle_code'), req.get('market'))
                st.markdown('**AI rationale / interpretation**')
                st.caption('The persisted proposal has no separate generated rationale. Its linked findings provide the traceable interpretation below.')
                for finding in evidence['findings']:
                    st.write(finding['summary'])
                    st.caption(f"Finding {finding['finding_id']} / source {finding['source_id']}")
                st.caption('Customer benefit is expressed in the proposal. Additional benefits need PM validation.')
                notes('Future-facing assumptions', req.get('assumptions', []))
                if req.get('review_date'):
                    st.write('Review date:', req['review_date'])
            with tabs[1]:
                for f in evidence['findings']:
                    with st.expander(f"{f['finding_id']} · {f['summary']}", expanded=True):
                        quote(f['evidence_quote'], f['evidence_valid'])
                        st.caption(f"Source {f['source_id']} · quote validated: {f['evidence_valid']}")
                for key, label in [('supporting_evidence', 'Direct support'), ('contradictory_evidence', 'Potential contradiction'), ('contextual_evidence', 'Context / unverified associations')]:
                    st.markdown(f'**{label}**')
                    if req.get(key):
                        for link in req[key]:
                            with st.expander(str(link.get('source_id', 'Evidence reference'))):
                                st.markdown(badge(link.get('relation', 'unverified')), unsafe_allow_html=True)
                                notes('Evidence limitations and rationale', link.get('limitations', []))
                                linked_source = next((s for s in evidence['sources'] if s['source_id'] == link.get('source_id')), None)
                                if linked_source:
                                    source_panel(linked_source)
                                else:
                                    st.warning('The original source is unavailable in this analysis. Review the reference before deciding.')
                                st.json(link, expanded=False)
                    else:
                        st.caption('No linked reference evidence of this type.')
                for s in evidence['sources']:
                    with st.expander(f"Inspect source · {s['source_id']}"):
                        source_panel(s)
            with tabs[2]:
                for warning in scope_warnings(evidence['sources'], market):
                    st.warning(warning)
                notes('Missing evidence / uncertainties', req.get('uncertainties', []))
                notes('Validation errors', req.get('validation_errors', []))
                notes('Future assumptions', req.get('assumptions', []))
                for conflict in selected_run['summary'].get('conflicts', []):
                    if conflict['conflict_id'] in req.get('conflict_ids', []):
                        st.json(conflict)
                st.caption('Broad satisfaction metrics do not invalidate specific complaints. Shared topics alone do not prove support. Validate market fit, sample selection and future relevance.')
            with tabs[3]:
                st.caption('Prototype policy F70-PM-v1. Project defaults, not BMW policy. Score = sum(weight × rating / 5).')
                st.dataframe([{'Factor': factor.replace('_', ' '), 'Weight %': weight,
                               'Rating / 5': assessment.get('ratings', {}).get(factor),
                               'Explanation': assessment.get('rationales', {}).get(factor, 'Missing PM input')}
                              for factor, weight in WEIGHTS.items()], hide_index=True, width='stretch')
                st.write('Missing inputs:', assessment.get('missing_factors', []))
                st.caption('Evidence confidence and uncertainty remain separate. Sample frequency is not population prevalence.')
                with st.form(f'score_{req_id}_{req["version"]}'):
                    actor = st.text_input('PM identifier', key='score_actor')
                    reason = st.text_area('Scoring change rationale')
                    ratings, reasons = {}, {}
                    for factor in WEIGHTS:
                        cols = st.columns([1, 2])
                        value = assessment.get('ratings', {}).get(factor)
                        options = [None, 0, 1, 2, 3, 4, 5]
                        ratings[factor] = cols[0].selectbox(factor.replace('_', ' ').title(), options,
                                                          index=options.index(value), format_func=lambda v: 'Unassessed' if v is None else str(v))
                        reasons[factor] = cols[1].text_input('Reason: ' + factor.replace('_', ' '), value=assessment.get('rationales', {}).get(factor, ''))
                    if st.form_submit_button('Save documented ratings'):
                        try:
                            updated = revise_requirement(req_id, actor=actor, action='score', rationale=reason, db_path=DB,
                                               ratings={k: v for k, v in ratings.items() if v is not None}, score_rationales=reasons,
                                               expected_version=req['version'])
                            st.session_state['decision_notice'] = f"Documented ratings saved. Status: Under review / version {updated['version']}."
                            st.rerun()
                        except (ValueError, KeyError) as e:
                            st.error(str(e))
            with tabs[4]:
                st.caption('PM actions are explicit. Edits and scoring reopen review and preserve prior approvals.')
                st.markdown('**Approve** accepts a scored proposal · **Reject** closes it · **Edit** reopens review · **Postpone** defers review · **Challenge AI** records an evidence-grounded question')
                with st.form(f'decide_{req_id}_{req["version"]}'):
                    actor = st.text_input('Responsible PM (unauthenticated demo identity)')
                    action = st.radio('Decision', ['approve', 'reject', 'edit', 'postpone', 'challenge'], horizontal=True, format_func=lambda a: 'Challenge AI' if a == 'challenge' else a.title())
                    rationale = st.text_area('Reason / challenge question (required)')
                    description = st.text_area('Revised wording — used only for Edit', value=req['description'])
                    review_date = st.text_input('Postpone review date (optional YYYY-MM-DD)')
                    st.caption('Challenge records the question and linked evidence for later AI review. No external call or automatic approval occurs.')
                    confirmed = st.checkbox('I confirm this action and its documented rationale for the selected requirement.')
                    if st.form_submit_button('Save decision to audit trail', type='primary'):
                        try:
                            if not confirmed:
                                raise ValueError('Confirm the action before saving. No decision has been recorded.')
                            updated = revise_requirement(req_id, actor=actor, action=action, rationale=rationale,
                                               description=description, review_date=review_date or None,
                                               expected_version=req['version'], db_path=DB)
                            st.session_state['decision_notice'] = f"Decision saved: {updated['status'].replace('_', ' ').title()} / version {updated['version']}. Audit history updated."
                            st.rerun()
                        except (ValueError, KeyError) as e:
                            st.error(str(e))
                for challenge in req.get('challenges', []):
                    st.warning('Challenge pending AI review: ' + challenge['question'])
                    st.write('Available grounding:', challenge)
            with tabs[5]:
                history = audit_history(req_id, DB)
                st.caption(f'{len(history)} events in chronological order. Previous decisions remain preserved.')
                for event in history:
                    before, after = event.get('old_json') or {}, event.get('new_json') or {}
                    with st.expander(f"#{event['event_id']} · {event['event_type']} · {event['timestamp']} · v{after.get('version')}"):
                        st.write('Actor:', event['actor_type'], event['actor_id'])
                        st.write('Rationale:', event['rationale'])
                        changes = [{'Field': k, 'Before': str(before.get(k)), 'After': str(after.get(k))}
                                   for k in sorted(set(before) | set(after)) if before.get(k) != after.get(k)]
                        st.dataframe(changes, hide_index=True, width='stretch')
                        st.json(event['metadata_json'])

elif page == 'Evaluation & export':
    if selected_run:
        st.write('Measured integration metrics for selected run')
        st.json(selected_run['summary'].get('metrics', {}))
        st.caption('Synthetic metrics measure fixture integration, not real model accuracy. Unknown costs stay unknown. No measured productivity claim without a manual baseline.')
    else:
        st.info('Select or run an analysis to measure extraction and provenance coverage.')
    st.write('Evaluation: use an approved representative sample; a PM independently labels source IDs, exact quotes, categories and need groups. Measure manual and assisted elapsed time, corrections and final evidence quality on the same sample. Keep labels local.')
    actor = st.text_input('Export actor (unauthenticated demo identity)')
    format = st.selectbox('Export format', ['json', 'csv'])
    if st.button('Prepare local portfolio export', disabled=not requirements):
        try:
            payload = portfolio_export(DB, requirements, actor, format)
            st.session_state['export'] = (run_id, format, payload)
            st.success('Local export saved and audited.')
        except ValueError as e:
            st.error(str(e))
    prepared = st.session_state.get('export')
    if prepared and prepared[0] == run_id:
        st.download_button('Download prepared portfolio', prepared[2], file_name=f'portfolio.{prepared[1]}',
                           mime='application/json' if prepared[1] == 'json' else 'text/csv')
    with st.expander('Analysis and export audit'):
        with connect(DB) as c:
            events = [dict(e) for e in c.execute('SELECT * FROM workflow_events ORDER BY event_id')]
        st.dataframe(events, width='stretch', hide_index=True)

