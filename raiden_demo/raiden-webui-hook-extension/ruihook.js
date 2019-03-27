
"use strict";

(function($) {
  let loaded = false;

  let accountAddr = null;

  function load() {
    if (loaded) {
      return;
    }

    const $account = $(".account");
    if ($account.length) {
      loaded = true;

      accountAddr = $account.text().trim();

      const res = chrome.storage.local.get([
        `showPisa-${accountAddr}`,
        `name-${accountAddr}`
      ], (result => {
        const showPisa = !!result[`showPisa-${accountAddr}`];
        const currentName = result[`name-${accountAddr}`] || null;
  
        if (showPisa) {
          $account.before('<span id="plusWhite"></span>');
          $account.before('<span id="pisaLogo"></span>');
        }
  
        if (!!currentName) {
          $account.text(currentName);
        }
        console.log(`Name is ${currentName}`);
      }));
    } else {
      console.log('Failed loading; will try again');
      setTimeout(load, 1000); // try again later
    }
  }

  $(load);

  chrome.runtime.onMessage.addListener(
    function(message, sender, sendResponse) {
        switch(message.type) {
            case "getCurrentUserAddress":
                sendResponse(accountAddr);
            break;
        }
    }
  );

})(jQuery);