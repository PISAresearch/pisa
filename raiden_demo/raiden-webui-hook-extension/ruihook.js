
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
      if (accountAddr == '0xccca21b97b27defc210f01a7e64119a784424d26s') {
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
