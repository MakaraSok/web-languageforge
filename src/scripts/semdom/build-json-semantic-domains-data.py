#!/usr/bin/env python


"""Parses semantic domain data from Ddp4.xml file (and related Ddp4Questions-*.xml files),
and outputs JSON data in the following format:

var semanticDomains_en = {
    '1.1 Sky': {
        'name': 'Sky',
        'abbreviation': '1.1',
        'description': 'Use this domain for words related to the sky.',
        'searchKeys': 'sky, firmament, canopy, vault',
    },
    # ...
};

var semanticDomainQuestions_en = {
    '1.1 Sky': [
        'What words refer to the air around the earth? (air, atmosphere, airspace, stratosphere, ozone layer)',
        'What words are used to refer to the place or area beyond the sky? (heaven, space, outer space, ether, void, solar system)',
        # ...
    ],
    # ...
}"""

import os, sys
import re
from pprint import pprint, pformat
import codecs
import collections
import json
import lxml
from lxml import etree
import glob

# Constants - mostly hardcoded filenames
DDP_FNAME = "Ddp4.xml"
QUESTIONS_FNAME_BASE = "Ddp4Questions-{}.xml"
DEFAULT_LANG = 'en' # If any language is lacking certain domains, substitute English for missing domains
ALL_LANGUAGES = ['en', 'es', 'fr', 'hi', 'id', 'km', 'ne', 'ru', 'th', 'ur', 'zh-CN']
LANGUAGES_TO_PROCESS = ['en']

OUTPUT_DDP_FNAME_BASE = "semanticDomains_{}.js"
OUTPUT_QUESTIONS_FNAME_BASE = "semanticDomainQuestions_{}.js"

# OUTPUT_PREFIX is the text to write *before* the JSON output
OUTPUT_PREFIX_DOMAINS = """\
'use strict';

// THIS FILE IS AUTOMATICALLY GENERATED.
// Do not make changes to this file; they will be overwritten.

// input systems languages data
var semanticDomains_{} = """

OUTPUT_PREFIX_QUESTIONS = OUTPUT_PREFIX_DOMAINS.replace('Domains', 'DomainQuestions')

# OUTPUT_SUFFIX is the text to write *after* the JSON output
OUTPUT_SUFFIX = ";\n"

def parse_file(fname):
    with codecs.open(fname, 'rU', 'utf-8-sig') as f:
        return etree.parse(f)

def build_ddp_data(tree, lang):
    result = collections.OrderedDict()
    for option in tree.iter('option'):
        record = collections.OrderedDict()
        key = option.find("./key").text
        for elemName in ["name", "abbreviation", "description"]:
            elem = option.find("./{0}/form[@ws='{1}']".format(elemName, lang))
            if elem is None:
                elem = option.find("./{0}/form[@ws='{1}']".format(elemName, DEFAULT_LANG))
            record[elemName] = elem.text.strip()
        # searchKeys needs to be a list, not a string: each language has multiple searchKey entries
        record['searchKeys'] = [elem.text.strip() for elem in option.findall("./searchKeys/form[@ws='{}']".format(lang))]
        result[key] = record
    return result

def build_question_data(tree, lang):
    result = collections.OrderedDict()
    for domain in tree.iter('semantic-domain'):
        key = domain.get('id')
        questions = [elem.text.strip().replace('\r', '\n') for elem in domain.findall("./question") if elem.text is not None]
        result[key] = questions
    return result

def write_json(data, lang, out_fname, prefix, suffix):
    with codecs.open(out_fname, 'wU', 'utf-8') as f:
        f.write(prefix)
        json.dump(data, f, ensure_ascii=False, indent=4, separators=(',', ': '))
        f.write(suffix)

def main():
    sys.stderr.write("Processing languages {}...\n".format(repr(ALL_LANGUAGES)))
    ddp_tree = parse_file(DDP_FNAME)
    for lang in ALL_LANGUAGES:  # Replace with ALL_LANGUAGES if desired
        underscore_lang = lang.replace('-', '_')  # So zh-CN doesn't produce invalid Javascript

        data = build_ddp_data(ddp_tree, lang)
        fname = OUTPUT_DDP_FNAME_BASE.format(lang)
        write_json(data, lang, fname, OUTPUT_PREFIX_DOMAINS.format(underscore_lang), OUTPUT_SUFFIX)

        questions_tree = parse_file(QUESTIONS_FNAME_BASE.format(lang))
        data = build_question_data(questions_tree, lang)
        fname = OUTPUT_QUESTIONS_FNAME_BASE.format(lang)
        write_json(data, lang, fname, OUTPUT_PREFIX_QUESTIONS.format(underscore_lang), OUTPUT_SUFFIX)

# To convert:
# root.findall('.//option')
# for each option:
#   extract ./key, ./name, ./abbreviation, ./description, ./searchKeys
#   find ws="en" (or current language)
#   put data in result dict

if __name__ == '__main__':
    main()