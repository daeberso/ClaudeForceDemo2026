@IsTest
private class CaseHeatMapControllerTest {
  // The demo org's "SDO Service - Case - On Create" flow runs Einstein demo helpers that need
  // config records unavailable in Apex tests. The flow skips Cases whose Account has
  // analyticsdemo_batch_id__c set, so every test Case gets an Account with it.
  private static final String AUTOMATION_BYPASS_BATCH_ID = 'apex-test';
  private static final String NO_LOCATION_ACCOUNT = 'No Location Co';
  private static Id noLocationAccountId;

  @TestSetup
  static void createNoLocationAccount() {
    insert newAccount(NO_LOCATION_ACCOUNT, null, null, null, null);
  }

  private static Account newAccount(
    String name,
    Decimal lat,
    Decimal lng,
    String country,
    String state
  ) {
    return new Account(
      Name = name,
      BillingLatitude = lat,
      BillingLongitude = lng,
      BillingCountry = country,
      BillingState = state,
      analyticsdemo_batch_id__c = AUTOMATION_BYPASS_BATCH_ID
    );
  }

  // Account without coordinates, used when a test Case has no meaningful Account.
  private static Id noLocationAccountId() {
    if (noLocationAccountId == null) {
      noLocationAccountId = [
        SELECT Id
        FROM Account
        WHERE Name = :NO_LOCATION_ACCOUNT
        LIMIT 1
      ]
      .Id;
    }
    return noLocationAccountId;
  }

  private static Contact newContact(
    String lastName,
    Decimal lat,
    Decimal lng,
    String country,
    String state
  ) {
    return new Contact(
      LastName = lastName,
      MailingLatitude = lat,
      MailingLongitude = lng,
      MailingCountry = country,
      MailingState = state
    );
  }

  private static Case newCase(
    Id contactId,
    Id accountId,
    String status,
    String priority
  ) {
    return new Case(
      Subject = 'Heat map test',
      ContactId = contactId,
      AccountId = accountId != null ? accountId : noLocationAccountId(),
      Status = status,
      Priority = priority
    );
  }

  private static CaseHeatMapController.CaseLocation findPoint(
    CaseHeatMapController.HeatMapData data,
    String country,
    String state
  ) {
    for (CaseHeatMapController.CaseLocation point : data.points) {
      if (point.country == country && point.state == state) {
        return point;
      }
    }
    return null;
  }

  // ---------- Positive ----------

  @IsTest
  static void returnsAllCasesWithContactFirstAndAccountFallback() {
    Account acct = newAccount('Fallback Co', 45.52, -122.68, 'USA', 'OR');
    insert acct;
    Contact withCoords = newContact('Geo', 37.77, -122.42, 'USA', 'CA');
    Contact withoutCoords = newContact('NoGeo', null, null, 'USA', 'WA');
    insert new List<Contact>{ withCoords, withoutCoords };
    insert new List<Case>{
      // Contact coordinates win over the Account's
      newCase(withCoords.Id, acct.Id, 'New', 'High'),
      // Contact has no coordinates -> Account fallback
      newCase(withoutCoords.Id, acct.Id, 'New', 'High'),
      // Neither Contact nor Account has coordinates -> unmapped
      newCase(withoutCoords.Id, null, 'New', 'High'),
      newCase(null, null, 'New', 'High')
    };

    Test.startTest();
    CaseHeatMapController.HeatMapData data = CaseHeatMapController.getCaseLocations(
      null,
      null,
      null,
      null
    );
    Test.stopTest();

    Assert.areEqual(
      2,
      data.mappedCount,
      'Contact and Account-fallback Cases are mapped'
    );
    Assert.areEqual(
      2,
      data.unmappedCount,
      'Cases without any coordinates are unmapped'
    );
    Assert.isFalse(data.limitReached, 'Row limit is not reached');
    CaseHeatMapController.CaseLocation ca = findPoint(
      data,
      'United States',
      'CA'
    );
    Assert.isNotNull(ca, 'Contact location is used');
    Assert.areEqual(37.77, Decimal.valueOf(ca.lat), 'Contact latitude is used');
    CaseHeatMapController.CaseLocation oregon = findPoint(
      data,
      'United States',
      'OR'
    );
    Assert.isNotNull(oregon, 'Account fallback location is used');
    Assert.areEqual(
      -122.68,
      Decimal.valueOf(oregon.lng),
      'Account longitude is used'
    );
  }

  @IsTest
  static void combinesCasesAtTheSameLocationAndNormalizesCountry() {
    Contact usa = newContact('Usa', 37.77, -122.42, 'USA', 'CA');
    Contact us = newContact('Us', 37.77, -122.42, 'US', 'CA');
    insert new List<Contact>{ usa, us };
    insert new List<Case>{
      newCase(usa.Id, null, 'New', 'Low'),
      newCase(usa.Id, null, 'New', 'Low'),
      newCase(us.Id, null, 'New', 'Low')
    };

    Test.startTest();
    CaseHeatMapController.HeatMapData data = CaseHeatMapController.getCaseLocations(
      null,
      null,
      null,
      null
    );
    Test.stopTest();

    Assert.areEqual(
      1,
      data.points.size(),
      'US and USA at the same coordinates combine into one point'
    );
    Assert.areEqual(
      3,
      data.points[0].count,
      'Point count is the number of Cases'
    );
    Assert.areEqual(
      'United States',
      data.points[0].country,
      'Country is normalized'
    );
  }

  @IsTest
  static void normalizesCountryAliasesAndBlanks() {
    Assert.areEqual(
      'United States',
      CaseHeatMapController.normalizeCountry(' united states of america ')
    );
    Assert.areEqual(
      'United States',
      CaseHeatMapController.normalizeCountry('U.S.A.')
    );
    Assert.areEqual(
      'United Kingdom',
      CaseHeatMapController.normalizeCountry('GB')
    );
    Assert.areEqual(
      'Switzerland',
      CaseHeatMapController.normalizeCountry(' Switzerland ')
    );
    Assert.areEqual(
      CaseHeatMapController.UNKNOWN,
      CaseHeatMapController.normalizeCountry(null)
    );
    Assert.areEqual(
      CaseHeatMapController.UNKNOWN,
      CaseHeatMapController.normalizeCountry('  ')
    );
  }

  @IsTest
  static void filtersByStatusAndPriority() {
    Contact c = newContact('Geo', 37.77, -122.42, 'USA', 'CA');
    insert c;
    insert new List<Case>{
      newCase(c.Id, null, 'New', 'High'),
      newCase(c.Id, null, 'Working', 'High'),
      newCase(c.Id, null, 'Working', 'Low')
    };

    Test.startTest();
    CaseHeatMapController.HeatMapData byStatus = CaseHeatMapController.getCaseLocations(
      new List<String>{ 'Working' },
      null,
      null,
      null
    );
    CaseHeatMapController.HeatMapData byBoth = CaseHeatMapController.getCaseLocations(
      new List<String>{ 'Working' },
      new List<String>{ 'High' },
      null,
      null
    );
    CaseHeatMapController.HeatMapData emptyLists = CaseHeatMapController.getCaseLocations(
      new List<String>(),
      new List<String>(),
      null,
      null
    );
    Test.stopTest();

    Assert.areEqual(2, byStatus.mappedCount, 'Status filter applied');
    Assert.areEqual(
      1,
      byBoth.mappedCount,
      'Status and Priority filters combine with AND'
    );
    Assert.areEqual(
      3,
      emptyLists.mappedCount,
      'Empty filter lists are not applied'
    );
  }

  @IsTest
  static void filtersByCreatedDateRangeInclusive() {
    Contact c = newContact('Geo', 37.77, -122.42, 'USA', 'CA');
    insert c;
    Case oldCase = newCase(c.Id, null, 'New', 'Low');
    Case midCase = newCase(c.Id, null, 'New', 'Low');
    Case newCaseRecord = newCase(c.Id, null, 'New', 'Low');
    insert new List<Case>{ oldCase, midCase, newCaseRecord };
    Test.setCreatedDate(oldCase.Id, Datetime.newInstance(2026, 1, 1, 12, 0, 0));
    Test.setCreatedDate(
      midCase.Id,
      Datetime.newInstance(2026, 3, 15, 23, 30, 0)
    );
    Test.setCreatedDate(
      newCaseRecord.Id,
      Datetime.newInstance(2026, 6, 1, 12, 0, 0)
    );

    Test.startTest();
    CaseHeatMapController.HeatMapData range = CaseHeatMapController.getCaseLocations(
      null,
      null,
      Date.newInstance(2026, 2, 1),
      Date.newInstance(2026, 3, 15)
    );
    CaseHeatMapController.HeatMapData fromOnly = CaseHeatMapController.getCaseLocations(
      null,
      null,
      Date.newInstance(2026, 3, 1),
      null
    );
    Test.stopTest();

    Assert.areEqual(
      1,
      range.mappedCount,
      'End date is inclusive of the whole day'
    );
    Assert.areEqual(2, fromOnly.mappedCount, 'Start date alone is applied');
  }

  // ---------- Negative ----------

  @IsTest
  static void returnsEmptyResultWhenNothingMatches() {
    Contact c = newContact('Geo', 37.77, -122.42, 'USA', 'CA');
    insert c;
    insert newCase(c.Id, null, 'New', 'Low');

    Test.startTest();
    CaseHeatMapController.HeatMapData data = CaseHeatMapController.getCaseLocations(
      new List<String>{ 'Closed' },
      null,
      null,
      null
    );
    Test.stopTest();

    Assert.areEqual(0, data.points.size(), 'No points');
    Assert.areEqual(0, data.mappedCount, 'No mapped Cases');
    Assert.areEqual(0, data.unmappedCount, 'No unmapped Cases');
  }

  @IsTest
  static void throwsHandledExceptionForUserWithoutCaseAccess() {
    Profile minimumAccess = [
      SELECT Id
      FROM Profile
      WHERE Name = 'Minimum Access - Salesforce'
      LIMIT 1
    ];
    String uniqueName =
      'heatmap' +
      System.currentTimeMillis() +
      '@example.com.test';
    User noAccess = new User(
      Alias = 'hmnoacc',
      Email = uniqueName,
      Username = uniqueName,
      LastName = 'NoAccess',
      ProfileId = minimumAccess.Id,
      TimeZoneSidKey = 'America/Phoenix',
      LocaleSidKey = 'en_US',
      EmailEncodingKey = 'UTF-8',
      LanguageLocaleKey = 'en_US'
    );
    insert noAccess;

    Boolean thrown = false;
    Test.startTest();
    System.runAs(noAccess) {
      try {
        CaseHeatMapController.getCaseLocations(null, null, null, null);
      } catch (AuraHandledException e) {
        thrown = true;
        Assert.areEqual(
          'You do not have access to view Case locations.',
          e.getMessage(),
          'Readable message'
        );
      }
    }
    Test.stopTest();

    Assert.isTrue(
      thrown,
      'User without Case access gets an AuraHandledException'
    );
  }

  // ---------- Bulk ----------

  @IsTest
  static void handles200CasesAcrossLocations() {
    List<Contact> contacts = new List<Contact>{
      newContact('Ca', 37.77, -122.42, 'USA', 'CA'),
      newContact('Or', 45.52, -122.68, 'US', 'OR'),
      newContact('Zh', 47.37, 8.54, 'Switzerland', 'ZH'),
      newContact('NoGeo', null, null, 'USA', 'WA')
    };
    insert contacts;
    List<Case> cases = new List<Case>();
    for (Integer i = 0; i < 200; i++) {
      cases.add(newCase(contacts[Math.mod(i, 4)].Id, null, 'New', 'Medium'));
    }
    insert cases;

    Test.startTest();
    CaseHeatMapController.HeatMapData data = CaseHeatMapController.getCaseLocations(
      null,
      null,
      null,
      null
    );
    Integer queriesUsed = Limits.getQueries();
    Test.stopTest();

    Assert.areEqual(
      150,
      data.mappedCount,
      '3 of every 4 Cases have coordinates'
    );
    Assert.areEqual(50, data.unmappedCount, '1 of every 4 Cases has none');
    Assert.areEqual(3, data.points.size(), 'One point per location');
    Assert.areEqual(
      50,
      findPoint(data, 'United States', 'OR').count,
      'Counts per point'
    );
    Assert.areEqual(1, queriesUsed, 'A single SOQL query regardless of volume');
  }
}
