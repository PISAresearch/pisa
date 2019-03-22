
"use strict";
(function($) {
  let loaded = false;

  function load() {
    if (loaded) {
      return;
    }

    const $account = $(".account");
    console.log($account);
    if ($account.length) {
      const accountAddr = $account.text().trim();
      if (accountAddr == '0xbbb1c891ccD690AC0EAF850822750e9D189A0055') {
        $account.before('<div id="pisaLogo"></div>');
        console.log('WebUI hook loaded');
      } else {
        console.log(`Not the right account: ${accountAddr}`);
      }
      loaded = true;
    } else {
      console.log('Failed loading');
      setTimeout(load, 1000); // try again later
    }
  }

  $(load);
})(jQuery);
