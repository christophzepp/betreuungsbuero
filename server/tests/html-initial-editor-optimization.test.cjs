'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);
const block = html.match(/<script id="flat-original-overlay-v253">([\s\S]*?)<\/script>/)?.[1] || '';

test('Anfangsbericht nutzt die volle Breite für die Aufenthaltsart und gleich hohe Auswahlfelder', () => {
  assert.match(html, /id:'residence_type'[^\n]+required:true,full:true/);
  assert.match(block, /#field_employment_status,#field_employer_occupation,#field_can_express_wishes/);
  assert.match(block, /height:38px;min-height:38px;box-sizing:border-box/);
});

test('derzeitiger Aufenthalt wird über den zentralen Master-Resolver vollständig aktualisiert', () => {
  assert.match(html, /try\{value=masterAutoValue\(reportId,field\)\}catch\(_error\)\{continue\}/);
  assert.match(block, /function initialCurrentResidenceV254\(\)/);
  assert.match(block, /if\(!institution\)return address/);
  assert.match(block, /if\(na\.includes\(ni\)\|\|ni\.includes\(na\)\)return address\.length>=institution\.length\?address:institution/);
  assert.match(block, /changed=initialSetManagedV254\('current_residence',initialCurrentResidenceV254\(\),'master'/);
});

test('Gesundheitsübersicht speist nur belegbare Anfangsberichtsfelder', () => {
  assert.match(block, /severe_diseases:initialUniqueV254\(diagnoses\)\.join\('; '\)/);
  assert.match(block, /treatment_care:treatment\.join\('\\n'\)/);
  assert.match(block, /changed=initialSetManagedV254\('severe_diseases',values\.severe_diseases,'health'/);
  assert.match(block, /changed=initialSetManagedV254\('treatment_care',values\.treatment_care,'health'/);
  assert.doesNotMatch(block, /initialSetManagedV254\('resources'/);
  assert.doesNotMatch(block, /initialSetManagedV254\('impairments'/);
  assert.match(block, /if\(key==='careLevel'\)\{state\.caseData\.health=state\.caseData\.health\|\|\{\};state\.caseData\.health\.careLevel=value/);
});

test('Bedarfe, Maßnahmen und Wille werden ausgewählt, kompakt und feldgenau übernommen', () => {
  assert.match(block, /selected=new Set\(Array\.isArray\(store\.reportSelections\)\?store\.reportSelections:\[\]\)/);
  assert.match(block, /planned_housing_changes:initialPlanningComposeV254\(current\.filter\(record=>housing\(record\)/);
  assert.match(block, /measures:initialPlanningComposeV254\(current\.filter\(record=>type\(record,'measure'\)\)\)/);
  assert.match(block, /special_matters:initialPlanningComposeV254\(current\.filter\(record=>type\(record,'need','measure','decision','review'\)\)\)/);
  assert.match(block, /goal_notes:''/);
  assert.match(block, /wishes_assets:initialPlanningComposeV254\(current\.filter\(record=>type\(record,'wish'\)&&finance\(record\)\)\)/);
  assert.match(block, /desired_outcome:initialPlanningComposeV254\(current\.filter\(record=>type\(record,'goal','wish'\)\)\)/);
  assert.match(html, /if\(field\.id==='contact_limit_reason'\|\|field\.id==='goal_notes'\)return null/);
});

test('falsche Planungsbegründung wird entfernt und nur bedingt oder nein exportiert', () => {
  assert.match(block, /if\(reason\?\.source==='planning'\)changed=initialSetManagedV254\('contact_limit_reason','','planning'/);
  assert.match(block, /let reasonText=''/);
  assert.match(block, /norm\(contactAbility\)==='nein'\)\{drawCheck\(p4,108\.75,316\.75\);reasonText=contactReason\}/);
  assert.match(block, /if\(reasonText\)drawRegions\(p4,regular,log,'contact_limit_reason'/);
  assert.match(block, /field\.id!=='contact_limit_reason'\|\|ability==='nein'\|\|ability==='bedingt'/);
});

test('Kontaktturnus kommt aus dem fallbezogenen Kontaktmonitor und respektiert Altkennungen', () => {
  assert.match(html, /var cfg=byId\[String\(c\.caseId\)\]\|\|\(legacyId&&byId\[legacyId\]\)\|\|\{\}/);
  assert.match(block, /data=await window\.__kmDocData\(caseId,\{\}\)/);
  assert.match(block, /30:'monatlich',60:'alle zwei Monate',90:'vierteljährlich',120:'alle vier Monate',180:'halbjährlich',365:'jährlich'/);
  assert.match(block, /initialSetManagedV254\('future_contacts',value,'monitor',\['monitor'\]\)/);
  assert.match(block, /SOURCE_LABELS\.monitor='KM'/);
});

test('manuelle Inhalte werden von automatischen Synchronisationen geschützt', () => {
  assert.match(block, /if\(entry\?\.cleared\)return false/);
  assert.match(block, /const replaceable=!entry\|\|\(isEmpty\(entry\.value\)&&!entry\.cleared\)\|\|managedSources\.includes\(entry\.source\)/);
  assert.match(block, /managedSources=\[source\]/);
});
