package com.zwift.android.networking;

import com.zwift.android.domain.model.ActivityComment;
import com.zwift.android.domain.model.ActivityFeedType;
import com.zwift.android.domain.model.ActivityNotes;
import com.zwift.android.domain.model.ActivityRideOn;
import com.zwift.android.domain.model.Announcement;
import com.zwift.android.domain.model.BasePlayerProfile;
import com.zwift.android.domain.model.Club;
import com.zwift.android.domain.model.ClubAcceptApplicationRequest;
import com.zwift.android.domain.model.ClubAcceptInviteRequest;
import com.zwift.android.domain.model.ClubAnnouncement;
import com.zwift.android.domain.model.ClubBanMemberRequest;
import com.zwift.android.domain.model.ClubBatchInviteRequest;
import com.zwift.android.domain.model.ClubChat;
import com.zwift.android.domain.model.ClubComment;
import com.zwift.android.domain.model.ClubCreateUpdateRequest;
import com.zwift.android.domain.model.ClubDenyInviteRequest;
import com.zwift.android.domain.model.ClubImage;
import com.zwift.android.domain.model.ClubJoinRequest;
import com.zwift.android.domain.model.ClubLeaveRequest;
import com.zwift.android.domain.model.ClubList;
import com.zwift.android.domain.model.ClubMemberCount;
import com.zwift.android.domain.model.ClubMemberList;
import com.zwift.android.domain.model.ClubMemberStatus;
import com.zwift.android.domain.model.ClubMembershipSecurityLevelRequest;
import com.zwift.android.domain.model.ClubNameValidationRequest;
import com.zwift.android.domain.model.ClubRejectApplicationRequest;
import com.zwift.android.domain.model.ClubRemoveMemberRequest;
import com.zwift.android.domain.model.ClubTOS;
import com.zwift.android.domain.model.ClubUnBanMemberRequest;
import com.zwift.android.domain.model.ClubWithdrawApplicationRequest;
import com.zwift.android.domain.model.ClubWithdrawInviteRequest;
import com.zwift.android.domain.model.ClubsSortDirection;
import com.zwift.android.domain.model.ClubsSortField;
import com.zwift.android.domain.model.ComboStats;
import com.zwift.android.domain.model.CommentRequest;
import com.zwift.android.domain.model.CreateClubEligibilityCheck;
import com.zwift.android.domain.model.CreateMeetupResponse;
import com.zwift.android.domain.model.CreateUpdateEventRequest;
import com.zwift.android.domain.model.CreateUpdateEventResponse;
import com.zwift.android.domain.model.Event;
import com.zwift.android.domain.model.EventFeed;
import com.zwift.android.domain.model.EventRegistrationResponse;
import com.zwift.android.domain.model.EventTemplates;
import com.zwift.android.domain.model.EventTypeV2;
import com.zwift.android.domain.model.FollowStatusEnvelope;
import com.zwift.android.domain.model.FollowingRelationship;
import com.zwift.android.domain.model.GameInfoJSON;
import com.zwift.android.domain.model.GameInfoVersionJSON;
import com.zwift.android.domain.model.Meetup;
import com.zwift.android.domain.model.MeetupEntitlement;
import com.zwift.android.domain.model.MeetupSummary;
import com.zwift.android.domain.model.PartnerAuthorizeUrlResponse;
import com.zwift.android.domain.model.PartnerConnectionEnvelope;
import com.zwift.android.domain.model.PartnerConnectionOAuth1Envelope;
import com.zwift.android.domain.model.PartnerCredentialsResponse;
import com.zwift.android.domain.model.PartnerStatusResponse;
import com.zwift.android.domain.model.PartnerUserInfo;
import com.zwift.android.domain.model.PlayerIdWithClubMemberStatus;
import com.zwift.android.domain.model.PlayerProfileImpl;
import com.zwift.android.domain.model.PrivateEventSaveRequestDto;
import com.zwift.android.domain.model.ProfileGoal;
import com.zwift.android.domain.model.RaceResultV2List;
import com.zwift.android.domain.model.RelayServerUrlEnvelope;
import com.zwift.android.domain.model.ReportClubChatRequest;
import com.zwift.android.domain.model.ReportClubRequest;
import com.zwift.android.domain.model.ReportEventRequest;
import com.zwift.android.domain.model.ReportUserRequest;
import com.zwift.android.domain.model.RideActivity;
import com.zwift.android.domain.model.SearchProfileQuery;
import com.zwift.android.domain.model.ServerEnvelope;
import com.zwift.android.domain.model.SimpleRideActivity;
import com.zwift.android.domain.model.SocialNotification;
import com.zwift.android.domain.model.SocialNotificationInput;
import com.zwift.android.domain.model.Sport;
import com.zwift.android.domain.model.Statistics;
import com.zwift.android.domain.model.UpdatablePlayerProfile;
import com.zwift.android.domain.model.campaign.ProfileCampaignsResponse;
import com.zwift.android.domain.model.campaign.ProgressReport;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Response;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.Field;
import retrofit2.http.FormUrlEncoded;
import retrofit2.http.GET;
import retrofit2.http.Headers;
import retrofit2.http.Multipart;
import retrofit2.http.POST;
import retrofit2.http.PUT;
import retrofit2.http.Part;
import retrofit2.http.Path;
import retrofit2.http.Query;
import rx.Observable;

public interface RestApi {
    @POST("clubs/membership/unban")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> A(@Body ClubUnBanMemberRequest clubUnBanMemberRequest);

    @POST("clubs/membership/kick")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> A0(@Body ClubRemoveMemberRequest clubRemoveMemberRequest);

    @POST("partners/{partner}/auth")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> B(@Path("partner") String str, @Body PartnerConnectionEnvelope partnerConnectionEnvelope);

    @PUT("private_event/{eventId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> B0(@Path("eventId") long j, @Body PrivateEventSaveRequestDto privateEventSaveRequestDto);

    @PUT("profiles/{profileId}/activities/{activityId}")
    @Headers({"Accept: application/json"})
    Observable<Void> C(@Path("profileId") long j, @Path("activityId") long j2, @Body ActivityNotes activityNotes);

    @GET("events/{id}")
    @Headers({"Accept: application/json"})
    Observable<Event> C0(@Path("id") long j, @Query("eventSecret") String str, @Query("skip_cache") boolean z);

    @POST("clubs/membership/reject-request")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> D(@Body ClubRejectApplicationRequest clubRejectApplicationRequest);

    @PUT("private_event/{eventId}/reject")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> D0(@Path("eventId") long j);

    @PUT("profiles/me/{profileId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<PlayerProfileImpl> E(@Path("profileId") long j, @Body UpdatablePlayerProfile updatablePlayerProfile);

    @GET("clubs/club")
    @Headers({"Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<ClubList> E0(@Query("limit") int i, @Query("start") int i2, @Query("name") String str, @Query("sport") List<Sport> list, @Query("member_count") ClubMemberCount clubMemberCount, @Query("location") String str2, @Query("sort_field") ClubsSortField clubsSortField, @Query("sort_dir") ClubsSortDirection clubsSortDirection);

    @GET("campaign/activity/report/campaigns/shortName/{shortName}")
    @Headers({"Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<ProgressReport> F(@Path("shortName") String str);

    @PUT("clubs/club/report")
    @Headers({"Accept: application/json"})
    Observable<Void> F0(@Body ReportClubRequest reportClubRequest);

    @GET("clubs/club/{clubId}/comment")
    @Headers({"Accept: application/json"})
    Observable<ClubChat> G(@Path("clubId") String str, @Query("created_before") long j, @Query("start") int i, @Query("limit") int i2);

    @GET("profiles/{profileId}/followers")
    @Headers({"Accept: application/json"})
    Observable<List<FollowingRelationship>> G0(@Path("profileId") long j, @Query("start") int i, @Query("limit") int i2, @Query("include-follow-requests") boolean z);

    @POST("clubs/membership/accept-request")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> H(@Body ClubAcceptApplicationRequest clubAcceptApplicationRequest);

    @POST("search/profiles/restricted")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<List<BasePlayerProfile>> H0(@Query("created_before") long j, @Query("start") int i, @Query("limit") int i2, @Query("followers_only") boolean z, @Query("social_facts") boolean z2, @Body SearchProfileQuery searchProfileQuery);

    @GET("clubs/club/{id}/roster")
    @Headers({"Accept: application/json"})
    Observable<ClubMemberList> I(@Path("id") String str, @Query("status") List<ClubMemberStatus> list, @Query("limit") int i, @Query("start") int i2);

    @POST("clubs/club/validate")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Response<Void>> I0(@Body ClubNameValidationRequest clubNameValidationRequest);

    @POST("support_portal/jwt")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<String> J();

    @PUT("clubs/club")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Response<String>> J0(@Body ClubCreateUpdateRequest clubCreateUpdateRequest);

    @GET("profiles/{profileId}/statistics")
    @Headers({"Accept: application/json"})
    Observable<Statistics> K(@Path("profileId") long j, @Query("sport") Sport sport, @Query("startDateTime") String str);

    @POST("profiles/{profileId}/activities/{activityId}/rideon")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> K0(@Path("profileId") long j, @Path("activityId") long j2, @Body ActivityRideOn activityRideOn);

    @GET("server")
    @Headers({"Accept: application/json"})
    Observable<ServerEnvelope> L();

    @GET("clubs/club/my-clubs/count")
    @Headers({"Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<Integer> L0(@Query("status") List<ClubMemberStatus> list);

    @PUT("private_event/{eventId}/accept")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> M(@Path("eventId") long j);

    @GET("race-results/entries")
    @Headers({"Accept: application/json"})
    Observable<RaceResultV2List> M0(@Query("event_subgroup_id") long j, @Query("start") int i, @Query("limit") int i2);

    @POST("profiles/{fromProfileId}/following/{toProfileId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<FollowStatusEnvelope> N(@Path("fromProfileId") long j, @Path("toProfileId") long j2, @Body FollowingRelationship followingRelationship);

    @GET("events/subgroups/invited_ride_sweepers/{subgroupId}")
    @Headers({"Accept: application/json"})
    Observable<List<BasePlayerProfile>> N0(@Path("subgroupId") long j);

    @POST("clubs/terms/{termsId}/accept")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> O(@Path("termsId") int i);

    @POST("clubs/club/{clubId}/comment")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<ClubComment> O0(@Path("clubId") String str, @Body CommentRequest commentRequest);

    @POST("partners/{partner}/oauth1/connect")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> P(@Path("partner") String str, @Body PartnerConnectionOAuth1Envelope partnerConnectionOAuth1Envelope);

    @GET("clubs/club/{id}/roster/find")
    @Headers({"Accept: application/json"})
    Observable<ClubMemberList> P0(@Path("id") String str, @Query("status") List<ClubMemberStatus> list, @Query("limit") int i, @Query("start") int i2, @Query("query") String str2, @Query("sort") boolean z);

    @DELETE("events/signup/{eventId}")
    Observable<Void> Q(@Path("eventId") long j);

    @GET("activities/{activityId}/rideon")
    @Headers({"Accept: application/json"})
    Observable<ArrayList<ActivityRideOn>> Q0(@Path("activityId") long j, @Query("only_me") boolean z);

    @PUT("notifications/{notificationId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> R(@Path("notificationId") long j, @Body SocialNotificationInput socialNotificationInput);

    @POST("activities/{activityId}/comment")
    @Headers({"Accept: application/json"})
    Observable<ActivityComment> R0(@Path("activityId") long j, @Body CommentRequest commentRequest);

    @Multipart
    @POST("profiles/{profileId}/photo")
    @Headers({"Accept: application/json"})
    Call<Void> S(@Path("profileId") long j, @Part("profileImage") RequestBody requestBody);

    Observable<PartnerCredentialsResponse> S0(String str);

    @GET("events/subgroups/entrants/{subgroupId}")
    @Headers({"Accept: application/json"})
    Observable<List<BasePlayerProfile>> T(@Path("subgroupId") long j, @Query("participation") String str, @Query("registered_before") long j2, @Query("start") int i, @Query("limit") int i2, @Query("type") String str2);

    @GET("activities/{activityId}")
    @Headers({"Accept: application/json"})
    Observable<RideActivity> T0(@Path("activityId") long j, @Query("rideOnTimesLimit") int i);

    @GET("partners/{partner}/user")
    @Headers({"Accept: application/json"})
    Observable<PartnerUserInfo> U(@Path("partner") String str);

    @POST("clubs/membership/reject-invite")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> U0(@Body ClubDenyInviteRequest clubDenyInviteRequest);

    @PUT("clubs/club/{clubId}/comment/report")
    @Headers({"Accept: application/json"})
    Observable<Void> V(@Path("clubId") String str, @Body ReportClubChatRequest reportClubChatRequest);

    @POST("clubs/membership/leave")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> V0(@Body ClubLeaveRequest clubLeaveRequest);

    @GET("activities/{activityId}/comment")
    @Headers({"Accept: application/json"})
    Observable<List<ActivityComment>> W(@Path("activityId") long j, @Query("created_before") long j2, @Query("start") int i, @Query("limit") int i2);

    @POST("events/subgroups/signup/{subgroupId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<EventRegistrationResponse> W0(@Path("subgroupId") long j, @Query("eventSecret") String str, @Body String str2);

    @PUT("events/report")
    @Headers({"Accept: application/json"})
    Observable<Void> X(@Body ReportEventRequest reportEventRequest);

    @DELETE("events/{id}")
    Observable<Void> X0(@Path("id") long j);

    @DELETE("profiles/{profileId}/goals/{goalId}")
    Observable<Void> Y(@Path("profileId") long j, @Path("goalId") long j2);

    @PUT("profiles/{followeeId}/follower/{followerId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> Y0(@Path("followeeId") long j, @Path("followerId") long j2, @Body FollowingRelationship followingRelationship);

    @DELETE("partners/{partner}/auth")
    Observable<Void> Z(@Path("partner") String str);

    @PUT("events-core/events/{event_id}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<Response<Void>> Z0(@Path("event_id") Long l2, @Body CreateUpdateEventRequest createUpdateEventRequest);

    @GET("clubs/club/find/short-name")
    @Headers({"Accept: application/json"})
    Observable<Club> a(@Query("shortName") String str);

    @GET("clubs/club/list/my-clubs")
    @Headers({"Accept: application/json"})
    Observable<ClubList> a0(@Query("limit") int i, @Query("start") int i2);

    @PUT("profiles/report")
    @Headers({"Accept: application/json"})
    Observable<Void> a1(@Body ReportUserRequest reportUserRequest);

    @DELETE("clubs/club/{clubId}/comment/{commentId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> b(@Path("clubId") String str, @Path("commentId") String str2);

    @DELETE("private_event/{eventId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> b0(@Path("eventId") long j);

    @POST("private_event")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<CreateMeetupResponse> b1(@Body PrivateEventSaveRequestDto privateEventSaveRequestDto);

    @GET("clubs/club/{clubId}/announcements")
    @Headers({"Accept: application/json"})
    Observable<List<ClubAnnouncement>> c(@Path("clubId") String str);

    @GET("game_info/version")
    @Headers({"Accept: application/json"})
    Observable<GameInfoVersionJSON> c0();

    @POST("clubs/membership/cancel-invite")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> c1(@Body ClubWithdrawInviteRequest clubWithdrawInviteRequest);

    @PUT("profiles/{profileId}/activities/{activityId}")
    @Headers({"Accept: application/json"})
    Observable<Void> d(@Path("profileId") long j, @Path("activityId") long j2, @Body SimpleRideActivity simpleRideActivity);

    @POST("clubs/membership/ban")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> d0(@Body ClubBanMemberRequest clubBanMemberRequest);

    @GET("private_event/feed")
    @Headers({"Accept: application/json"})
    Observable<List<MeetupSummary>> d1(@Query("start_date") Long l2, @Query("end_date") Long l3, @Query("status") String str, @Query("organizer_only_past_events") boolean z);

    @GET("servers")
    @Headers({"Accept: application/json"})
    Observable<Response<RelayServerUrlEnvelope>> e();

    @GET("partners/{partner}/oauth1/authorize_url_json")
    @Headers({"Accept: application/json"})
    Observable<PartnerAuthorizeUrlResponse> e0(@Path("partner") String str);

    @POST("partners/{partner}/search/profiles")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<List<BasePlayerProfile>> e1(@Path("partner") String str, @Query("created_before") long j, @Query("start") int i, @Query("limit") int i2, @Body SearchProfileQuery searchProfileQuery);

    @GET("profiles/{publicId}")
    @Headers({"Accept: application/json"})
    Observable<PlayerProfileImpl> f(@Path("publicId") String str);

    @DELETE("activities/{activityId}/comment/{commentId}")
    Observable<Void> f0(@Path("activityId") long j, @Path("commentId") long j2);

    @DELETE("clubs/club/{clubId}/announcement/{announcementId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> f1(@Path("clubId") String str, @Path("announcementId") String str2);

    @POST("clubs/membership/change-security-level")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> g(@Body ClubMembershipSecurityLevelRequest clubMembershipSecurityLevelRequest);

    @PUT("push/fcm/{type}/{token}/enables")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> g0(@Path("type") String str, @Path("token") String str2, @Body Map map);

    @POST("clubs/membership/cancel-request")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> g1(@Body ClubWithdrawApplicationRequest clubWithdrawApplicationRequest);

    @GET("events/subgroups/invited_ride_leaders/{subgroupId}")
    @Headers({"Accept: application/json"})
    Observable<List<BasePlayerProfile>> h(@Path("subgroupId") long j);

    @GET("activity-feed/feed/club/{clubId}")
    @Headers({"Accept: application/json"})
    Observable<List<RideActivity>> h0(@Path("clubId") String str, @Query("includeSelf") boolean z, @Query("includeFollowees") boolean z2, @Query("includeFavorites") boolean z3, @Query("start_after_activity_id") Long l2, @Query("limit") int i);

    @GET("notifications")
    @Headers({"Accept: application/json"})
    Observable<List<SocialNotification>> h1();

    @GET("clubs/club")
    @Headers({"Accept: application/json"})
    Observable<ClubList> i(@Query("limit") int i, @Query("start") int i2);

    @GET("profiles/{profileId}/followees")
    @Headers({"Accept: application/json"})
    Observable<List<FollowingRelationship>> i0(@Path("profileId") long j, @Query("start") int i, @Query("limit") int i2);

    @GET("events-core/events/template/categories?affiliation=clubs")
    @Headers({"Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<List<EventTemplates>> i1(@Query("eventType") EventTypeV2 eventTypeV2, @Query("sport") Sport sport);

    @POST("clubs/membership/batch-invite")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Response<Void>> j(@Body ClubBatchInviteRequest clubBatchInviteRequest);

    @GET("activity-feed/feed/")
    @Headers({"Accept: application/json"})
    Observable<List<RideActivity>> j0(@Query("feedType") ActivityFeedType activityFeedType, @Query("profile_id") Long l2, @Query("start_after_activity_id") Long l3, @Query("limit") int i);

    @GET("partners/{partner}/credentials")
    @Headers({"Accept: application/json"})
    Observable<List<PartnerCredentialsResponse>> j1(@Path("partner") String str);

    @GET("clubs/membership/{clubId}/status")
    @Headers({"Accept: application/json"})
    Observable<List<PlayerIdWithClubMemberStatus>> k(@Path("clubId") String str, @Query("profileIds") List<Long> list);

    @GET("game_info")
    @Headers({"Accept: application/json"})
    Observable<GameInfoJSON> k0();

    @GET("clubs/club/{clubId}/stats")
    @Headers({"Accept: application/json"})
    Observable<ComboStats> k1(@Path("clubId") String str, @Query("daysOffset") Integer num);

    @POST("clubs/membership/join")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Response<Void>> l(@Body ClubJoinRequest clubJoinRequest);

    @PUT("profiles/{profileId}/goals/{goalId}")
    @Headers({"Accept: application/json"})
    Observable<Void> l0(@Path("profileId") long j, @Path("goalId") long j2, @Body ProfileGoal profileGoal);

    @DELETE("profiles/{fromProfileId}/following/{toProfileId}")
    Observable<Void> l1(@Path("fromProfileId") long j, @Path("toProfileId") long j2);

    @GET("profiles/{loggedInProfileId}/followees-in-common/{profileId}")
    @Headers({"Accept: application/json"})
    Observable<List<FollowingRelationship>> m(@Path("loggedInProfileId") long j, @Path("profileId") long j2);

    @GET("profiles/{profileId}/activities")
    @Headers({"Accept: application/json"})
    Observable<List<RideActivity>> m0(@Path("profileId") long j, @Query("before") long j2, @Query("limit") int i);

    @POST("clubs/club/{clubId}/announcement")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<ClubAnnouncement> n(@Path("clubId") String str, @Body ClubAnnouncement clubAnnouncement);

    @GET("private_event/{eventId}")
    @Headers({"Accept: application/json"})
    Observable<Meetup> n0(@Path("eventId") long j);

    @GET("announcements/active")
    @Headers({"Accept: application/json"})
    Observable<List<Announcement>> o();

    @GET("event-feed/campaign/{shortName}")
    @Headers({"Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<List<Event>> o0(@Path("shortName") String str, @Query("from") int i, @Query("to") int i2, @Query("sports") List<Sport> list);

    @GET("event-feed")
    @Headers({"Accept: application/json"})
    Observable<EventFeed> p(@Query("from") Long l2, @Query("to") Long l3, @Query("limit") int i, @Query("sport") List<Sport> list, @Query("microservice") String str, @Query("microserviceResourceId") String str2, @Query("cursor") String str3);

    @GET("profiles/{profileId}/activities/{activityId}/rideon")
    @Headers({"Accept: application/json"})
    Observable<ArrayList<ActivityRideOn>> p0(@Path("profileId") long j, @Path("activityId") long j2, @Query("created_before") long j3, @Query("start") int i, @Query("limit") int i2);

    @GET("campaign/profile/campaigns")
    @Headers({"Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<ProfileCampaignsResponse> q();

    @POST("clubs/club")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Response<String>> q0(@Body ClubCreateUpdateRequest clubCreateUpdateRequest);

    @POST("push/fcm/{type}/{token}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> r(@Path("type") String str, @Path("token") String str2, @Body Object obj);

    @POST("profiles/{profileId}/goals")
    @Headers({"Accept: application/json"})
    Observable<ProfileGoal> r0(@Path("profileId") long j, @Body ProfileGoal profileGoal);

    @GET("profiles/{profileId}")
    @Headers({"Accept: application/json"})
    Observable<PlayerProfileImpl> s(@Path("profileId") long j);

    @GET("clubs/terms/latest")
    @Headers({"Accept: application/json"})
    Observable<ClubTOS> s0();

    @GET("clubs/gallery/{type}")
    @Headers({"Accept: application/json"})
    Observable<List<ClubImage>> t(@Path("type") ClubImage.ImageType imageType);

    @GET("partners/{partner}/auth")
    @Headers({"Accept: application/json"})
    Observable<PartnerStatusResponse> t0(@Path("partner") String str);

    @GET("profiles/{profileId}/goals")
    @Headers({"Accept: application/json"})
    Observable<List<ProfileGoal>> u(@Path("profileId") long j);

    @GET("clubs/club/{clubId}")
    @Headers({"Accept: application/json"})
    Observable<Club> u0(@Path("clubId") String str);

    @GET("private_event/entitlement")
    @Headers({"Accept: application/json"})
    Observable<MeetupEntitlement> v();

    @GET("clubs/club/list/my-clubs")
    @Headers({"Accept: application/json"})
    Observable<ClubList> v0(@Query("limit") int i, @Query("start") int i2, @Query("status") List<ClubMemberStatus> list);

    @POST("events-core/events")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    io.reactivex.rxjava3.core.Observable<CreateUpdateEventResponse> w(@Body CreateUpdateEventRequest createUpdateEventRequest);

    @POST("clubs/membership/accept-invite")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Response<Void>> w0(@Body ClubAcceptInviteRequest clubAcceptInviteRequest);

    @GET("clubs/club/can-create")
    @Headers({"Accept: application/json"})
    Observable<CreateClubEligibilityCheck> x();

    @PUT("clubs/club/{clubId}/announcement/{announcementId}")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> x0(@Path("clubId") String str, @Path("announcementId") String str2, @Body ClubAnnouncement clubAnnouncement);

    @DELETE("profiles/{profileId}/activities/{activityId}")
    Observable<Void> y(@Path("profileId") long j, @Path("activityId") long j2);

    @FormUrlEncoded
    @POST("users/password-reset/")
    @Headers({"Accept: application/json", "Content-type: application/x-www-form-urlencoded"})
    Observable<Void> y0(@Field("password-new") String str, @Field("password-confirm") String str2);

    @POST("profiles/{profileId}/privacy")
    @Headers({"Content-Type: application/json", "Accept: application/json"})
    Observable<Void> z(@Path("profileId") long j, @Body Map map);

    @GET("profiles/me/")
    @Headers({"Accept: application/json"})
    Observable<PlayerProfileImpl> z0();
}
