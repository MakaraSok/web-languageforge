'use strict';

angular.module('bellows.services')

// Lexicon Entry Service
.factory('editorDataService', ['$q', 'sessionService', 'editorOfflineCache', 'commentsOfflineCache',
  'silNoticeService', 'lexCommentService', 'utilService',
function ($q, sessionService, cache, commentsCache,
          notice, commentService, util) {
  var entries = [];
  var visibleEntries = [];
  var filteredEntries = [];
  var entryListModifiers = {
    sortBy: {
      label: 'Word',
      value: 'lexeme'
    },
    sortOptions: [],
    sortReverse: false,
    filterBy: '',
    filterOptions: [],
    filterType: 'isNotEmpty'
  };
  var browserInstanceId = Math.floor(Math.random() * 1000000);
  var api = undefined;

  var showInitialEntries = function showInitialEntries() {
    return sortAndFilterEntries(true);
  };

  var showMoreEntries = function showMoreEntries() {
    var increment = 50;
    if (visibleEntries.length < filteredEntries.length) {
      util.arrayCopyRetainingReferences(filteredEntries.slice(0, visibleEntries.length + increment),
        visibleEntries);
    }
  };

  var registerEntryApi = function registerEntryApi(a) {
    api = a;
  };

  /**
   * Called when loading the controller
   * @return promise
   */
  var loadEditorData = function loadEditorData(lexiconScope) {
    var deferred = $q.defer();
    if (entries.length === 0) { // first page load
      if (cache.canCache()) {
        notice.setLoading('Loading Dictionary');
        loadDataFromOfflineCache().then(function (projectObj) {
          if (projectObj.isComplete) {
            showInitialEntries().then(function () {
              lexiconScope.finishedLoading = true;
              notice.cancelLoading();
              refreshEditorData(projectObj.timestamp).then(function (result) {
                deferred.resolve(result);
              });
            });

          } else {
            entries = [];
            console.log('Editor: cached data was found to be incomplete. Full download started...');
            notice.setLoading('Downloading Full Dictionary.');
            notice.setPercentComplete(0);
            doFullRefresh().then(function (result) {
              deferred.resolve(result);
              notice.setPercentComplete(100);
              notice.cancelLoading();
            });
          }

        }, function () {
          // no data found in cache
          console.log('Editor: no data found in cache. Full download started...');
          notice.setLoading('Downloading Full Dictionary.');
          notice.setPercentComplete(0);
          doFullRefresh().then(function (result) {
            deferred.resolve(result);
            notice.setPercentComplete(100);
            notice.cancelLoading();
          });
        });
      } else {
        console.log('Editor: caching not enabled. Full download started...');
        notice.setLoading('Downloading Full Dictionary.');
        notice.setPercentComplete(0);
        doFullRefresh().then(function (result) {
          deferred.resolve(result);
          notice.setPercentComplete(100);
          notice.cancelLoading();
        });
      }
    } else {
      // intentionally not showing any loading message here
      refreshEditorData().then(function (result) {
        deferred.resolve(result);
      });
    }

    return deferred.promise;
  };

  function doFullRefresh(offset) {
    offset = offset || 0;
    var deferred = $q.defer();
    api.dbeDtoFull(browserInstanceId, offset, function (result) {
      if (!result.ok) {
        notice.cancelLoading();
        deferred.reject(result);
        return;
      }

      var newOffset = offset + result.data.itemCount;
      var totalCount = result.data.itemTotalCount;
      notice.setPercentComplete(parseInt(newOffset * 100 / totalCount));
      processEditorDto(result, false).then(function () {
        if (offset === 0) {
          showInitialEntries();
        }

        if (newOffset < totalCount) {
          doFullRefresh(newOffset).then(function () {
            deferred.resolve(result);
          });
        } else {
          deferred.resolve(result);
        }
      });
    });

    return deferred.promise;
  }

  /**
   * Call this after every action that requires a pull from the server
   * @param timestamp
   * @return promise
   */
  var refreshEditorData = function refreshEditorData(timestamp) {
    var deferred = $q.defer();

    // get data from the server
    if (Offline.state === 'up') {
      api.dbeDtoUpdatesOnly(browserInstanceId, timestamp, function (result) {
        processEditorDto(result, true).then(function (result) {
          if (result.data.itemCount > 0) {
            console.log('Editor: processed ' + result.data.itemCount + ' entries from server.');
          }

          deferred.resolve(result);
        });
      });
    } else {
      return $q.when();
    }

    return deferred.promise;
  };

  var addEntryToEntryList = function addEntryToEntryList(entry) {
    entries.unshift(entry);
  };

  var removeEntryFromLists = function removeEntryFromLists(id) {
    angular.forEach([entries, filteredEntries, visibleEntries], function (list) {
      var i = getIndexInList(id, list);
      if (angular.isDefined(i)) {
        list.splice(i, 1);
      }
    });

    return cache.deleteEntry(id);
  };

  /**
   * Persists the Lexical data in the offline cache store
   */
  function storeDataInOfflineCache(data, isComplete) {
    var deferred = $q.defer();
    if (data.timeOnServer && cache.canCache()) {
      cache.updateProjectData(data.timeOnServer, data.commentsUserPlusOne, isComplete)
        .then(function () {
          cache.updateEntries(data.entries).then(function () {
            commentsCache.updateComments(data.comments).then(function () {
              deferred.resolve();
            });
          });
        });
    } else {
      deferred.reject();
    }

    return deferred.promise;
  }

  /**
   *
   * @returns {promise} which resolves to an project object containing the epoch cache timestamp
   */
  function loadDataFromOfflineCache() {
    var startTime = performance.now();
    var deferred = $q.defer();
    var endTime;
    var numOfEntries;
    cache.getAllEntries().then(function (result) {
      util.arrayExtend(entries, result);
      numOfEntries = result.length;

      if (result.length > 0) {
        commentsCache.getAllComments().then(function (result) {
          util.arrayExtend(commentService.comments.items.all, result);

          cache.getProjectData().then(function (result) {
            commentService.comments.counts.userPlusOne = result.commentsUserPlusOne;
            endTime = performance.now();
            console.log('Editor: Loaded ' + numOfEntries + ' entries from cache in ' +
              ((endTime - startTime) / 1000).toFixed(2) + ' seconds');
            deferred.resolve(result);

          }, function () { deferred.reject(); });
        }, function () { deferred.reject(); });
      } else {
        // we got zero entries
        deferred.reject();
      }

    }, function () { deferred.reject(); });

    return deferred.promise;
  }

  function processEditorDto(result, updateOnly) {
    var deferred = $q.defer();
    var isLastRequest = true;
    if (result.ok) {
      commentService.comments.counts.userPlusOne = result.data.commentsUserPlusOne;
      if (!updateOnly) {
        util.arrayExtend(entries, result.data.entries);
        commentService.comments.items.all.push
          .apply(commentService.comments.items.all, result.data.comments);
      } else {

        // splice updates into entry list
        // don't need to modify filteredEntries or visibleEntries since those are regenerated
        // from sortAndFilterEntries() below
        angular.forEach(result.data.entries, function (entry) {

          // splice into entries list
          var i = getIndexInList(entry.id, entries);
          if (angular.isDefined(i)) {
            entries[i] = entry;
          } else {
            addEntryToEntryList(entry);
          }
        });

        // splice comment updates into comments list
        angular.forEach(result.data.comments, function (comment) {
          var i = getIndexInList(comment.id, commentService.comments.items.all);
          if (angular.isDefined(i)) {
            commentService.comments.items.all[i] = comment;
          } else {
            commentService.comments.items.all.push(comment);
          }
        });

        // remove deleted entries according to deleted ids
        angular.forEach(result.data.deletedEntryIds, removeEntryFromLists);

        angular.forEach(result.data.deletedCommentIds, commentService.removeCommentFromLists);

        // only sort and filter the list if there have been changes to entries (or deleted entries)
        if (result.data.entries.length > 0 || result.data.deletedEntryIds.length > 0) {
          sortAndFilterEntries(true);
        }
      }

      if (result.data.itemCount &&
          result.data.itemCount + result.data.offset < result.data.itemTotalCount) {
        isLastRequest = false;
      }

      storeDataInOfflineCache(result.data, isLastRequest);

      commentService.updateGlobalCommentCounts();
      deferred.resolve(result);
      return deferred.promise;
    }
  }

  function getIndexInList(id, list) {
    var index = undefined;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.id === id) {
        index = i;
        break;
      }
    }

    return index;
  }

  function sortList(config, list) {
    var collator = Intl.Collator(_getInputSystemForSort(config));

    // temporary mapped array
    var mapped = list.map(function (entry, i) {
      return { index: i, value: getSortableValue(config, entry) };
    });

    mapped.sort(function (a, b) {
      if (entryListModifiers.sortReverse === true) {
        return -collator.compare(a.value, b.value);
      } else {
        return collator.compare(a.value, b.value);
      }
    });

    return mapped.map(function (el) {
      return list[el.index];
    });
  }

  function sortEntries(shouldResetVisibleEntriesList) {
    var startTime = performance.now();
    return sessionService.getSession().then(function (session) {
      var config = session.projectSettings().config;

      // the length = 0 followed by Array.push.apply is a method of replacing the contents of
      // an array without creating a new array thereby keeping original references
      // to the array
      var entriesSorted = sortList(config, entries);
      util.arrayCopyRetainingReferences(entriesSorted, entries);
      var filteredEntriesSorted = sortList(config, filteredEntries);
      util.arrayCopyRetainingReferences(filteredEntriesSorted, filteredEntries);
      var visibleEntriesSorted = sortList(config, visibleEntries);
      if (shouldResetVisibleEntriesList) {
        util.arrayCopyRetainingReferences(filteredEntriesSorted.slice(0, 50), visibleEntries);
      } else {
        console.log('sortedVisibleEntries');
        console.log(visibleEntriesSorted);
        util.arrayCopyRetainingReferences(visibleEntriesSorted, visibleEntries);
        console.log(visibleEntries);
      }

      var sortTime = ((performance.now() - startTime) / 1000).toFixed(2);
      if (sortTime > 0.5) {
        console.warn('Sort time took ' + sortTime + ' seconds.');
      }
    });

  }

  function filterEntries(shouldResetVisibleEntriesList) {
    return sessionService.getSession().then(function (session) {
      var config = session.projectSettings().config;
      if (entryListModifiers.filterBy) {
        util.arrayCopyRetainingReferences(entries.filter(function (entry) {
          return entryMeetsFilterCriteria(config, entry);
        }), filteredEntries);

      } else {
        util.arrayCopyRetainingReferences(entries, filteredEntries);
      }

      if (shouldResetVisibleEntriesList) {
        util.arrayCopyRetainingReferences(filteredEntries.slice(0, 50), visibleEntries);

      } else {
        var filteredVisibleEntries = visibleEntries.filter(function (entry) {
          return entryMeetsFilterCriteria(config, entry);
        });

        util.arrayCopyRetainingReferences(filteredVisibleEntries, visibleEntries);
      }
    });
  }

  function entryMeetsFilterCriteria(config, entry) {
    var mustNotBeEmpty = entryListModifiers.filterType === 'isNotEmpty';
    var containsData = false;
    var filterType = entryListModifiers.filterBy.type;
    if (['comments', 'exampleSentences', 'pictures', 'audio'].indexOf(filterType) !== -1) {

      // special filter types
      switch (filterType) {
        case 'comments':
          containsData = commentService.getEntryCommentCount(entry.id) > 0;
          break;
        case 'exampleSentences':
          angular.forEach(entry.senses, function (sense) {
            if (sense.examples && sense.examples.length > 0) {
              containsData = true;
            }
          });

          break;
        case 'pictures':
          angular.forEach(entry.senses, function (sense) {
            if (sense.pictures && sense.pictures.length > 0) {
              containsData = true;
            }
          });

          break;
        case 'audio':
          var fieldKey = entryListModifiers.sortBy.value;
          var field;

          if (fieldKey in config.entry.fields) {
            field = config.entry.fields[fieldKey];
          } else if (fieldKey in config.entry.fields.senses.fields) {
            field = config.entry.fields.senses.fields[fieldKey];
          }

          angular.forEach(config.entry.fields, function (field, fieldKey) {
            if (field.type === 'multitext') {
              angular.forEach(entry[fieldKey], function (fieldNode, ws) {
                  if (ws && util.isAudio(ws) && fieldNode.value !== '') {
                    containsData = true;
                  }
                });
            }

            if (fieldKey === 'senses') {
              angular.forEach(entry.senses, function (sense) {
                angular.forEach(config.entry.fields.senses.fields, function (field, fieldKey) {
                  if (field.type === 'multitext') {
                    angular.forEach(sense[fieldKey], function (fieldNode, ws) {
                      if (ws && util.isAudio(ws) && fieldNode.value !== '') {
                        containsData = true;
                      }
                    });
                  }

                  if (fieldKey === 'examples') {
                    angular.forEach(sense.examples, function (example) {
                      angular.forEach(config.entry.fields.senses.fields.examples.fields,
                        function (field, fieldKey) {
                          if (field.type === 'multitext') {
                            angular.forEach(example[fieldKey], function (fieldNode, ws) {
                              if (ws && util.isAudio(ws) && fieldNode.value !== '') {
                                containsData = true;
                              }
                            });
                          }
                        }
                      );
                    });
                  }
                });
              });
            }
          });

          break;
      }
    } else {

      // filter by entry or sense field
      var dataNode;
      if (entryListModifiers.filterBy.level === 'entry') {
        dataNode = entry[entryListModifiers.filterBy.value];
      } else { // sense level
        if (entry.senses.length > 0) {
          dataNode = entry.senses[0][entryListModifiers.filterBy.value];
        }
      }

      if (dataNode) {
        switch (filterType) {
          case 'multitext':
            if (dataNode[entryListModifiers.filterBy.inputSystem]) {
              containsData = dataNode[entryListModifiers.filterBy.inputSystem].value !== '';
            }

            break;
          case 'optionlist':
            containsData = dataNode.value !== '';
            break;
          case 'multioptionlist':
            containsData = (dataNode.values.length > 0);
            break;
        }
      }
    }

    return (mustNotBeEmpty && containsData || !mustNotBeEmpty && !containsData);
  }

  function sortAndFilterEntries(shouldResetVisibleEntriesList) {
    // todo: so far I haven't found a good case for NOT resetting visibleEntriesList.
    // and always reset visibleEntriesList - chris 2017-07
    return sortEntries(shouldResetVisibleEntriesList).then(function () {
      return filterEntries(shouldResetVisibleEntriesList);
    });
  }

  function _getOptionListItem(optionlist, key) {
    var itemToReturn = { value: '' };
    angular.forEach(optionlist.items, function (item) {
      if (item.key === key) {
        itemToReturn = item;
      }
    });

    return itemToReturn;
  }

  function _getInputSystemForSort(config) {
    var inputSystem = 'en';
    var fieldKey = entryListModifiers.sortBy.value;
    var field;
    if (fieldKey in config.entry.fields) {
      field = config.entry.fields[fieldKey];
    } else if (fieldKey in config.entry.fields.senses.fields) {
      field = config.entry.fields.senses.fields[fieldKey];
    }

    if (field && field.type === 'multitext') {
      inputSystem = field.inputSystems[0];
    }

    return inputSystem;
  }

  function getSortableValue(config, entry) {
    var fieldKey = entryListModifiers.sortBy.value;
    var sortableValue = '';
    var field;
    var dataNode;
    var isSpecialMultitext = (fieldKey == 'lexeme' || fieldKey == 'citationForm');
    if (fieldKey in config.entry.fields && fieldKey in entry) {
      field = config.entry.fields[fieldKey];
      dataNode = entry[fieldKey];
    } else if (fieldKey in config.entry.fields.senses.fields && angular.isDefined(entry.senses) &&
      entry.senses.length > 0 && fieldKey in entry.senses[0]
    ) {
      field = config.entry.fields.senses.fields[fieldKey];
      dataNode = entry.senses[0][fieldKey];
    }

    if (field || isSpecialMultitext) {
      if (isSpecialMultitext || field.type === 'multitext') {

        // special case for lexeme form / citation form.  Use citation form if available, fall back to lexeme form
        if (fieldKey == 'lexeme' || fieldKey == 'citationForm') {
          var citationFormInputSystems = config.entry.fields.citationForm.inputSystems;
          if (entry.citationForm && citationFormInputSystems.length > 0 && citationFormInputSystems[0] in entry.citationForm) {
            sortableValue = entry.citationForm[citationFormInputSystems[0]].value;
          }
          if (!sortableValue) {
            var lexemeInputSystems = config.entry.fields.lexeme.inputSystems;
            if (entry.lexeme && lexemeInputSystems.length > 0 && lexemeInputSystems[0] in entry.lexeme) {
              sortableValue = entry.lexeme[lexemeInputSystems[0]].value;
            }
          }

          // regular multi-text field
        } else {
          if (field.inputSystems.length > 0 && field.inputSystems[0] in dataNode) {
            sortableValue = dataNode[field.inputSystems[0]].value;
          }
        }
      } else if (field.type === 'optionlist') {
        if (config.optionlists && config.optionlists[field.listCode]) {
          // something weird here with config.optionlists not being set consistently when this is
          // called - cjh 2017-07
          sortableValue = _getOptionListItem(config.optionlists[field.listCode], dataNode.value)
            .value;
        } else {
          sortableValue = dataNode.value;
        }
      } else if (field.type === 'multioptionlist' && dataNode.values.length > 0) {
        if (field.listCode === 'semantic-domain-ddp4') {
          if (semanticDomains_en // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
              [dataNode.values[0]]) {
            sortableValue = semanticDomains_en // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
              [dataNode.values[0]].value;
          } else {
            sortableValue = dataNode.values[0];
          }
        } else {
          if (config.optionlists && config.optionlists[field.listCode]) {
            sortableValue = _getOptionListItem(
              config.optionlists[field.listCode],
              dataNode.values[0]
            ).value;
          } else {
            sortableValue = dataNode.values[0].value;
          }
        }
      }
    }

    if (!sortableValue) {
      return '[Empty]';
    }

    return sortableValue;
  }

  //noinspection JSUnusedLocalSymbols
  /**
   * A function useful for debugging (prints out to the console the lexeme values)
   * @param list
   */
  function printLexemesInList(list) {
    sessionService.getSession().then(function (session) {
      var config = session.projectSettings().config;
      var ws = config.entry.fields.lexeme.inputSystems[1];
      var arr = [];
      for (var i = 0; i < list.length; i++) {
        if (angular.isDefined(list[i].lexeme[ws])) {
          arr.push(list[i].lexeme[ws].value);
        }
      }

      console.log(arr);
    });
  }

  return {
    loadDataFromOfflineCache: loadDataFromOfflineCache,
    storeDataInOfflineCache: storeDataInOfflineCache,
    processEditorDto: processEditorDto,
    registerEntryApi: registerEntryApi,
    loadEditorData: loadEditorData,
    refreshEditorData: refreshEditorData,
    removeEntryFromLists: removeEntryFromLists,
    addEntryToEntryList: addEntryToEntryList,
    getIndexInList: getIndexInList,
    entries: entries,
    visibleEntries: visibleEntries,
    showInitialEntries: showInitialEntries,
    showMoreEntries: showMoreEntries,
    sortEntries: sortEntries,
    filterEntries: filterEntries,
    filteredEntries: filteredEntries,
    entryListModifiers: entryListModifiers,
    getSortableValue: getSortableValue
  };

}]);
