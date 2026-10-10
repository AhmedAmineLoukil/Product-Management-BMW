"""Local Streamlit PM console; reads/writes ONLY local SQLite. No AI calls."""
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import streamlit as st
from src.ai.db import (DEFAULT_DB, list_requirements, get_requirement,
                       get_linked_evidence, audit_history, revise_requirement)

st.set_page_config(page_title='BMW F70 Requirements Copilot', layout='wide')
DB = Path(os.getenv('BMW_DB_PATH', str(ROOT/DEFAULT_DB)))
st.title('BMW F70 | Evidence-Aware Requirements')
st.caption('Hackathon prototype • Local database • AI proposes; product manager decides')
st.warning('Privacy: Run locally with approved data. Do not deploy private BMW feedback on a public Streamlit host.')
requirements = list_requirements(DB)
if not requirements:
    st.info('No requirements yet. Run: python scripts/run_ai_f70.py --mode simulated --synthetic')
    st.stop()

status_counts = {}
for r in requirements:
    status_counts[r['status']] = status_counts.get(r['status'],0)+1
c1,c2,c3 = st.columns(3)
c1.metric('Requirements', len(requirements))
c2.metric('Pending / review',status_counts.get('pending',0)+status_counts.get('under_review',0))
c3.metric('Approved',status_counts.get('approved',0))

rows = []
for r in requirements:
    assessment = r.get('priority_assessment', {})
    rows.append({'ID':r['requirement_id'], 'Description':r['description'], 'Status':r['status'],
                 'Priority score':assessment.get('score'),
                 'Triage (not priority)':r.get('scoring_observations',{}).get('evidence_triage_signal_0_100'),
                 'Evidence':r.get('evidence_level'), 'Version':r.get('version')})
st.dataframe(rows,hide_index=True,use_container_width=True)
req_id=st.selectbox('Inspect a requirement', options=[r['requirement_id'] for r in requirements],
                    format_func=lambda i: next(r['description'] for r in requirements if r['requirement_id']==i)[:105])
req=get_requirement(req_id,DB)
assessment=req.get('priority_assessment',{})
st.subheader(req['description'])
st.caption(f"ID {req_id} • Category {req['category']} • Status {req['status']} • v{req['version']}")
t1,t2,t3=st.tabs(['Evidence & rationale','PM scoring and decision','Audit timeline'])
with t1:
    left,right=st.columns(2)
    with left:
        st.markdown('**Evidence summary**')
        st.json(req.get('scoring_observations',{}))
        st.write('**AI assumptions:**',req.get('assumptions', []))
        st.write('**AI uncertainties:**',req.get('uncertainties', []))
        st.write('**Validation issues:**',req.get('validation_errors', []))
    with right:
        links=get_linked_evidence(req_id,DB)
        st.markdown('**Linked findings**')
        for item in links['findings']:
            with st.expander(f"{item['finding_id']}: {item['summary'][:85]}"):
                st.write('Quote:',item['evidence_quote'])
                st.write('Source:',item['source_id'])
                st.write('Evidence valid:',item['evidence_valid'])
        st.markdown('**Source comment locations**')
        for source in links['sources']:
            with st.expander(source['source_id']):
                st.write('File:',source.get('source_file'),'Location:',source.get('source_location'))
                st.write('Country:',source.get('market'))
                st.write('Original text:',source.get('text'))
                st.json(source.get('metadata',{}))
with t2:
    st.write('**Priority scoring: PM supplies four missing ratings and evidence-based reasons.**')
    st.caption('Observed frequency and quote support are computed from the selected sample, not the global BMW customer population.')
    st.write('Provisional triage signal:',req.get('scoring_observations',{}).get('evidence_triage_signal_0_100'))
    st.write('Reviewed priority:',assessment.get('score'),'—',assessment.get('priority'))
    missing=assessment.get('missing_factors',[])
    st.write('Awaiting factor assessment:', ', '.join(missing) or 'None')
    reviewer=st.text_input('PM identifier (required)', key=f'{req_id}_actor')
    reason=st.text_area('Decision rationale (required)',key=f'{req_id}_reason')
    with st.form(f'{req_id}_score_form'):
        st.markdown('#### Priority factors (0–5)')
        rationales={};ratings={}
        factors=['customer_impact','market_relevance','future_relevance','rough_feasibility']
        for factor in factors:
            default=assessment.get('ratings',{}).get(factor,3)
            ratings[factor]=st.slider(factor.replace('_',' ').title(),0,5,int(default),key=f'{req_id}_{factor}')
            rationales[factor]=st.text_input(f'Why this {factor} rating?',key=f'{req_id}_{factor}_why',
                                            value=assessment.get('rationales',{}).get(factor,''))
        save_score=st.form_submit_button('Save PM ratings')
        if save_score:
            try:
                revised=revise_requirement(req_id,actor=reviewer,action='score',rationale=reason,
                                           ratings=ratings,score_rationales=rationales,db_path=DB)
                st.success(f"Score updated to {revised['priority_assessment']['score']}/100")
                st.rerun()
            except (ValueError,KeyError) as e:
                st.error(str(e))
    st.markdown('#### Human decision')
    action=st.selectbox('Action',['approve','reject','postpone','challenge','edit'])
    edited=st.text_area('Edited wording (only for Edit)',value=req['description']) if action=='edit' else None
    if st.button('Record decision',type='primary'):
        try:
            changed=revise_requirement(req_id,actor=reviewer,action=action,rationale=reason,
                                        description=edited,db_path=DB)
            st.success(f"Logged {action}: status={changed['status']}, version={changed['version']}")
            st.rerun()
        except (ValueError,KeyError) as e:
            st.error(str(e))
with t3:
    for event in audit_history(req_id,DB):
        with st.expander(f"#{event['event_id']} — {event['event_type']} — {event['timestamp']}"):
            st.write('Initiated by:',event['actor_type'],event['actor_id'])
            st.write('Rationale:',event['rationale'])
            st.write('Before/after version:',
                     (event.get('old_json') or {}).get('version'),
                     (event.get('new_json') or {}).get('version'))
            st.json(event)
