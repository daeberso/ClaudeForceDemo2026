/**
 * Supplies Case locations for the caseHeatMap LWC (KAN-7).
 * A Case is placed at its Contact's mailing coordinates, falling back to its Account's billing coordinates.
 */
public with sharing class CaseHeatMapController {
  @TestVisible
  private static final Integer MAX_ROWS = 10000;

  @TestVisible
  private static final String UNKNOWN = 'Unknown';

  private static final Map<String, String> COUNTRY_ALIASES = new Map<String, String>{
    'us' => 'United States',
    'u.s.' => 'United States',
    'usa' => 'United States',
    'u.s.a.' => 'United States',
    'united states' => 'United States',
    'united states of america' => 'United States',
    'uk' => 'United Kingdom',
    'u.k.' => 'United Kingdom',
    'gb' => 'United Kingdom',
    'great britain' => 'United Kingdom',
    'united kingdom' => 'United Kingdom'
  };

  public class CaseLocation {
    @AuraEnabled
    public Double lat;
    @AuraEnabled
    public Double lng;
    @AuraEnabled
    public String country;
    @AuraEnabled
    public String state;
    @AuraEnabled
    public Integer count = 0;
  }

  public class HeatMapData {
    @AuraEnabled
    public List<CaseLocation> points = new List<CaseLocation>();
    @AuraEnabled
    public Integer mappedCount = 0;
    @AuraEnabled
    public Integer unmappedCount = 0;
    @AuraEnabled
    public Boolean limitReached = false;
  }

  /**
   * Returns Case locations matching the optional filters. Null or empty filters are not applied.
   * Dates filter on CreatedDate and are inclusive, in the running user's time zone.
   */
  @AuraEnabled(cacheable=true)
  public static HeatMapData getCaseLocations(
    List<String> statuses,
    List<String> priorities,
    Date startDate,
    Date endDate
  ) {
    List<String> conditions = new List<String>();
    Map<String, Object> binds = new Map<String, Object>{
      'maxRows' => MAX_ROWS + 1
    };
    if (statuses != null && !statuses.isEmpty()) {
      conditions.add('Status IN :statuses');
      binds.put('statuses', statuses);
    }
    if (priorities != null && !priorities.isEmpty()) {
      conditions.add('Priority IN :priorities');
      binds.put('priorities', priorities);
    }
    if (startDate != null) {
      conditions.add('CreatedDate >= :startTime');
      binds.put(
        'startTime',
        Datetime.newInstance(startDate, Time.newInstance(0, 0, 0, 0))
      );
    }
    if (endDate != null) {
      conditions.add('CreatedDate < :endTime');
      binds.put(
        'endTime',
        Datetime.newInstance(endDate.addDays(1), Time.newInstance(0, 0, 0, 0))
      );
    }

    // Only fixed clauses are concatenated; all filter values are bind variables.
    String soql =
      'SELECT Contact.MailingLatitude, Contact.MailingLongitude, Contact.MailingCountry, Contact.MailingState,' +
      ' Account.BillingLatitude, Account.BillingLongitude, Account.BillingCountry, Account.BillingState' +
      ' FROM Case' +
      (conditions.isEmpty()
        ? ''
        : ' WHERE ' + String.join(conditions, ' AND ')) +
      ' ORDER BY CreatedDate DESC LIMIT :maxRows';

    List<Case> cases;
    try {
      // AccessLevel.USER_MODE is the dynamic-SOQL equivalent of WITH USER_MODE (CRUD/FLS enforced).
      cases = (List<Case>) Database.queryWithBinds(
        soql,
        binds,
        AccessLevel.USER_MODE
      );
    } catch (QueryException e) {
      AuraHandledException ex = new AuraHandledException(
        'You do not have access to view Case locations.'
      );
      ex.setMessage('You do not have access to view Case locations.');
      throw ex;
    }

    HeatMapData data = new HeatMapData();
    if (cases.size() > MAX_ROWS) {
      data.limitReached = true;
      cases.remove(MAX_ROWS);
    }

    Map<String, CaseLocation> locationsByKey = new Map<String, CaseLocation>();
    for (Case c : cases) {
      CaseLocation location = toLocation(c);
      if (location == null) {
        data.unmappedCount++;
        continue;
      }
      data.mappedCount++;
      String key =
        location.lat +
        '|' +
        location.lng +
        '|' +
        location.country +
        '|' +
        location.state;
      if (!locationsByKey.containsKey(key)) {
        locationsByKey.put(key, location);
      }
      locationsByKey.get(key).count++;
    }
    data.points = locationsByKey.values();
    return data;
  }

  private static CaseLocation toLocation(Case c) {
    CaseLocation location = new CaseLocation();
    if (
      c.Contact?.MailingLatitude != null &&
      c.Contact?.MailingLongitude != null
    ) {
      location.lat = c.Contact.MailingLatitude;
      location.lng = c.Contact.MailingLongitude;
      location.country = normalizeCountry(c.Contact.MailingCountry);
      location.state = normalizeState(c.Contact.MailingState);
    } else if (
      c.Account?.BillingLatitude != null &&
      c.Account?.BillingLongitude != null
    ) {
      location.lat = c.Account.BillingLatitude;
      location.lng = c.Account.BillingLongitude;
      location.country = normalizeCountry(c.Account.BillingCountry);
      location.state = normalizeState(c.Account.BillingState);
    } else {
      return null;
    }
    return location;
  }

  @TestVisible
  private static String normalizeCountry(String country) {
    if (String.isBlank(country)) {
      return UNKNOWN;
    }
    String trimmed = country.trim();
    String alias = COUNTRY_ALIASES.get(trimmed.toLowerCase());
    return alias != null ? alias : trimmed;
  }

  private static String normalizeState(String state) {
    return String.isBlank(state) ? UNKNOWN : state.trim();
  }
}
