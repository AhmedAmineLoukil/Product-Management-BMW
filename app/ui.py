"""Shared presentation helpers; no analysis or persistence logic."""
from html import escape
from pathlib import Path
import streamlit as st


def styles():
    st.markdown(f'<style>{Path(__file__).with_name("theme.css").read_text(encoding="utf-8")}</style>', unsafe_allow_html=True)


def badge(value):
    label = str(value or 'Unknown').replace('_', ' ')
    tone = {'approved': 'positive', 'high': 'blue', 'rejected': 'negative',
            'postponed': 'muted', 'pending': 'amber', 'under review': 'amber',
            'verified quote': 'positive', 'conflict': 'negative'}.get(label.lower(), 'muted')
    return f'<span class="badge {tone}">{escape(label.title())}</span>'


def header(page, vehicle, market):
    descriptions = {
        'Executive dashboard': 'Customer signals, portfolio health and decisions that need your attention.',
        'Data & analysis': 'Inspect source coverage and prepare an evidence-grounded analysis.',
        'Findings explorer': 'Trace customer signals to their original quotes and source context.',
        'Requirements portfolio': 'Evaluate proposals, examine evidence and document product decisions.',
        'Evaluation & export': 'Review analysis quality and prepare an audited portfolio export.',
    }
    st.markdown(f'<div class="app-header"><div><span class="eyebrow">BMW · PRODUCT INTELLIGENCE</span>'
                f'<h1>{escape(page)}</h1><p>{descriptions[page]}</p></div>'
                f'<div class="scope"><strong>{escape(vehicle)}</strong><span>{escape(market)} market</span>'
                '<span>3–5 year horizon</span></div></div>', unsafe_allow_html=True)


def quote(text, validated=None):
    label = badge('verified quote') if validated else badge('unverified quote') if validated is False else ''
    st.markdown(f'<div class="quote">{label}<blockquote>{escape(str(text or "No original quote recorded."))}</blockquote>'
                '<span class="eyebrow">ORIGINAL CUSTOMER WORDING</span></div>', unsafe_allow_html=True)


def notes(label, items):
    st.markdown(f'**{label}**')
    if not items:
        st.caption('None recorded.')
    elif isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                with st.expander(str(item.get('summary', item.get('source_id', 'Evidence reference')))):
                    st.json(item)
            else:
                st.write('• ' + str(item))
    else:
        st.write(items)


def portfolio(items):
    if not items:
        st.info('No requirements match this view. Adjust the filters or select another analysis.')
        return
    st.dataframe(items, hide_index=True, width='stretch', row_height=54,
                 column_config={
                     'ID': st.column_config.TextColumn('Requirement', width='small'),
                     'Proposal': st.column_config.TextColumn('Customer-facing proposal', width='large'),
                     'Score': st.column_config.ProgressColumn('Priority / 100', min_value=0, max_value=100, format='%.0f'),
                     'Status': st.column_config.TextColumn('Decision', width='small'),
                     'Confidence': st.column_config.TextColumn('Evidence confidence', width='small'),
                 })
