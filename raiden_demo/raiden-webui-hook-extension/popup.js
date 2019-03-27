
'use strict';

// From https://github.com/akiomik/chrome-storage-promise
chrome.storage.promise = {
  // local
  local: {
      get: (keys) => {
          let promise = new Promise((resolve, reject) => {
              chrome.storage.local.get(keys, (items) => {
                  let err = chrome.runtime.lastError;
                  if (err) {
                      reject(err);
                  } else {
                      resolve(items);
                  }
              });
          });
          return promise;
      },
      set: (items) => {
          let promise = new Promise((resolve, reject) => {
              chrome.storage.local.set(items, () => {
                  let err = chrome.runtime.lastError;
                  if (err) {
                      reject(err);
                  } else {
                      resolve();
                  }
              });
          });
          return promise;
      },
      getBytesInUse: (keys) => {
          let promise = new Promise((resolve, reject) => {
              chrome.storage.local.getBytesInUse(keys, (items) => {
                  let err = chrome.runtime.lastError;
                  if (err) {
                      reject(err);
                  } else {
                      resolve(items);
                  }
              });
          });
          return promise;
      },
      remove: (keys) => {
          let promise = new Promise((resolve, reject) => {
              chrome.storage.local.remove(keys, () => {
                  let err = chrome.runtime.lastError;
                  if (err) {
                      reject(err);
                  } else {
                      resolve();
                  }
              });
          });
          return promise;
      },
      clear: () => {
          let promise = new Promise((resolve, reject) => {
              chrome.storage.local.clear(() => {
                  let err = chrome.runtime.lastError;
                  if (err) {
                      reject(err);
                  } else {
                      resolve();
                  }
              });
          });
          return promise;
      }
  }
};

const btnTogglePisaLogo = document.getElementById('btnTogglePisaLogo');
const name = document.getElementById('name');
const btnSetName = document.getElementById('btnSetName');

let currentAddress = null;
let currentlyShowingPisa;
let currentName;

btnTogglePisaLogo.onclick = () => {
    chrome.storage.promise.local.set({
        [`showPisa-${currentAddress}`]: !currentlyShowingPisa
    }).then( () => { 
        currentlyShowingPisa = !currentlyShowingPisa
        updateUI();
    });
};

btnSetName.onclick = () => {
    if (currentAddress === null) {
        alert("Error: no address found.")
        return;
    }

    const newName = prompt("Choose name (or empty to unset)");

    chrome.storage.promise.local.set({ [`name-${currentAddress}`]: newName }).then(updateUI);
};

function updateUI() {
    btnTogglePisaLogo.innerText = currentlyShowingPisa ? "Hide Pisa logo" : "Show Pisa logo";
}

//Get current address, update UI
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {type: "getCurrentUserAddress"}, async (response) => {
        currentAddress = response || null;

        if (currentAddress) {
            const result = await chrome.storage.promise.local.get([
                `showPisa-${currentAddress}`,
                `name-${currentAddress}`
            ]);

            currentlyShowingPisa = !!result[`showPisa-${currentAddress}`];
            currentName = result[`name-${currentAddress}`] || null;

            updateUI();
        }
    });
});
