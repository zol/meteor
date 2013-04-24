// connect middleware
Accounts.oauth2._handleRequest = function (service, query, res) {
  console.log('oauth:handleRequest: query:' + EJSON.stringify(query));
  
  // check if user authorized access
  if (!query.error) {
    // Prepare the login results before returning.  This way the
    // subsequent call to the `login` method will be immediate.

    // Run service-specific handler.
    var oauthResult = service.handleOauthRequest(query);

    // If there is a userId in the state, we're augmenting that account
    if (query.state.indexOf(',') != -1) {
      var userId = query.state.split(',')[1];

      Accounts.oauth._loginResultForState[query.state] =
        Accounts.augmentUserWithExternalService(
          userId, service.serviceName, 
          oauthResult.serviceData, oauthResult.options);
    } else {
      // Get or create user doc and login token for reconnect.
      Accounts.oauth._loginResultForState[query.state] =
        Accounts.updateOrCreateUserFromExternalService(
          service.serviceName, oauthResult.serviceData, oauthResult.options);
    }
  }

  // Either close the window, redirect, or render nothing
  // if all else fails
  Accounts.oauth._renderOauthResults(res, query);
};
