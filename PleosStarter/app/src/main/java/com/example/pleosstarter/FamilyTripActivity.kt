package com.example.pleosstarter

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.*
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import ai.pleos.playground.navi.data.*
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointIndex
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Parked-use prototype. The OS applies automotive restrictions; no overlay or system privileges. */
class FamilyTripActivity : Activity() {
    private val ui = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val prefs by lazy { getSharedPreferences("family-trip", MODE_PRIVATE) }
    private val mint get() = MoagilBrand.navy
    private val ink get() = MoagilBrand.ink
    private val canvas get() = MoagilBrand.background
    private val soft get() = MoagilBrand.mist
    private val railText get() = MoagilBrand.secondary
    private val muted get() = MoagilBrand.secondary
    private lateinit var status: TextView
    private lateinit var subtitle: TextView
    private lateinit var cards: LinearLayout
    private lateinit var summary: TextView
    private lateinit var sortButton: Button
    private lateinit var cardsScroll: ScrollView
    // dp() uses the established 2x car-display scale. Use the actual app window,
    // including its split-screen bounds, rather than the full physical display.
    private val windowUnits get() = resources.configuration.screenWidthDp / 2
    private val compactScreen get() = windowUnits < 900 || resources.configuration.screenHeightDp / 2 < 520
    private val slimScreen get() = windowUnits < 600
    private var restoredScroll = 0
    private var activeTab = "home"
    private var undoBar:LinearLayout?=null
    private var undoPlaceId=""
    private var undoPlaceName=""
    private var undoUntil=0L
    private val expireUndo=Runnable{updateUndoBar()}
    private var overviewRow:View?=null
    private lateinit var toolsRow: View
    private val tabButtons = mutableMapOf<String,Button>()
    private val tabIcons = mutableMapOf<String,CupertinoTabIcon>()
    private var roadRoutingEnabled = false
    private var categoryFilter = "all"
    private var sortMode = "votes"
    private var connected = false
    private var lastSync = ""
    private val filterButtons = mutableMapOf<String, Button>()
    private val favorites by lazy { prefs.getStringSet("favorites", emptySet())!!.toMutableSet() }
    private var roomId = ""
    private var ownerToken = ""
    private var joinToken = ""
    private var publicUrl = "http://localhost:8787"
    private var localOnly = true
    private val sheets=mutableSetOf<AlertDialog>()
    private var resultSheet:AlertDialog?=null
    private val safety by lazy {DrivingSafety(this){allowed->
        if(!allowed)dismissSheets()
        if(::cards.isInitialized)renderCards()
    }}
    private fun dismissSheets(){sheets.toList().forEach{it.dismiss()};sheets.clear()}
    private fun canInteract():Boolean{
        if(safety.allowed)return true
        Toast.makeText(this,"주차 후 이용해 주세요. 차량 상태를 확인할 수 없을 때도 조작을 제한해요.",Toast.LENGTH_SHORT).show()
        return false
    }
    private var active = false
    private var loading = false
    private var sessionGeneration=0
    private var revision = -1
    private var room: JSONObject? = null
    private var navi: NaviHelper? = null
    private var naviReady = false
    private var currentLocation: CurrentLocationInfo? = null
    private var locationReceivedAt = 0L
    private var locationRenderedAt = 0L
    private var pending: JSONObject? = null
    private var pendingWaypoints = emptyList<JSONObject>()
    private var destinationConfirmed = false
    private var waypointsConfirmed = false
    private var waypointNamesOnly = false
    private var navigationStatus = "기본 내비 연결 중"
    private val checkDestination = object : Runnable {
        override fun run() {
            if (pending == null) return
            runCatching { navi?.getDestinationInfo() }
            if(pendingWaypoints.isNotEmpty())runCatching { navi?.getWaypointInfo() }
            ui.postDelayed(this,2000)
        }
    }
    private val routeTimeout = Runnable {
        if (pending != null) { pending = null; ui.removeCallbacks(checkDestination); navigationStatus = "내비 응답을 확인하지 못했습니다. 기본 내비에서 목적지를 확인하세요."; refreshStatus(); renderCards() }
    }
    private val tick = object : Runnable {
        override fun run() { if (active) { sync(); ui.postDelayed(this, 3000) } }
    }
    private val listener = object : NaviHelperEventListener {
        override fun onError(errorCode: NaviErrorCode) { ui.post { pending = null; ui.removeCallbacks(routeTimeout); ui.removeCallbacks(checkDestination); navigationStatus = "내비 처리 오류: $errorCode"; Log.w("Moagil", navigationStatus); refreshStatus(); renderCards() } }
        override fun onRouteStarted(routeStartInfo: RouteStartInfo) { runCatching { navi?.getDestinationInfo() } }
        override fun onDestinationChanged() { runCatching { navi?.getDestinationInfo() } }
        override fun onRoutingCompleted() { runCatching { navi?.getDestinationInfo() } }
        override fun onDestinationInfo(destinationInfo: DestinationInfo) { ui.post { acknowledge(destinationInfo) } }
        override fun onWayPointInfo(waypoints: List<WaypointInfo>) { ui.post {
            if(pending==null || pendingWaypoints.isEmpty())return@post
            waypointsConfirmed=waypoints.size==pendingWaypoints.size && waypoints.zip(pendingWaypoints).all{(actual,expected)->actual.name==expected.getString("name") && waypointCoordinatesMatch(actual,expected)}
            // The emulator can return ordered names with all waypoint coordinates unset.
            // Keep that weaker response distinct from coordinate verification.
            waypointNamesOnly=waypoints.size==pendingWaypoints.size && waypoints.zip(pendingWaypoints).all{(actual,expected)->actual.name==expected.getString("name")&&actual.latitude==0.0&&actual.longitude==0.0}
            finishAcknowledgement()
        } }
        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) { ui.post {
            currentLocation=currentLocationInfo;locationReceivedAt=android.os.SystemClock.elapsedRealtime()
            // Position updates must not rebuild focused course buttons and jump the scroll view.
            if(activeTab=="places"&&locationReceivedAt-locationRenderedAt>10000){locationRenderedAt=locationReceivedAt;renderCards()}
        } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MoagilBrand.configure(this)
        roomId = prefs.getString("roomId", "")!!
        ownerToken = SessionStore.read(prefs,"ownerToken")
        joinToken = SessionStore.read(prefs,"joinToken")
        room = runCatching { JSONObject(prefs.getString("cachedRoom", "")!!) }.getOrNull()
        room?.remove("ownerToken");room?.remove("joinToken");room?.let{prefs.edit().putString("cachedRoom",it.toString()).apply()}
        activeTab=savedInstanceState?.getString("activeTab") ?: "home"
        intent.getStringExtra(GleoActionActivity.TAB_EXTRA)?.takeIf{it in setOf("course","ballot")}?.let{activeTab=it}
        categoryFilter=savedInstanceState?.getString("categoryFilter") ?: "all"
        sortMode=savedInstanceState?.getString("sortMode") ?: "votes"
        restoredScroll=savedInstanceState?.getInt("scrollY") ?: 0
        buildScreen()
        renderCards()
        try {
            navi = NaviHelper(applicationContext).also { helper ->
                helper.initialize(onConnected = {
                    helper.addListener(listener)
                    ui.post { naviReady = true; navigationStatus = "기본 내비 연결됨"; refreshStatus(); renderCards() }
                    runCatching { helper.getCurrentLocationInfo() }
                }, onFailed = { error -> ui.post { naviReady = false; navigationStatus = "내비 연결 실패: ${error.message}"; refreshStatus() } })
            }
        } catch (e: Exception) { navigationStatus = "내비 연결 실패: ${e.message}"; refreshStatus() }
    }

    override fun onNewIntent(intent:Intent){
        super.onNewIntent(intent);setIntent(intent)
        intent.getStringExtra(GleoActionActivity.TAB_EXTRA)?.takeIf{it in setOf("course","ballot")}?.let{
            activeTab=it;cardsScroll.scrollTo(0,0);renderCards()
        }
    }
    private fun buildScreen() {
        filterButtons.clear();tabButtons.clear();tabIcons.clear()
        if(compactScreen){buildCompactScreen();return}
        window.statusBarColor = canvas
        val root = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; setBackgroundColor(canvas); setPadding(dp(18),dp(20),dp(22),dp(16)) }
        setContentView(root)
        val rail=column().apply { setPadding(dp(18),dp(16),dp(18),dp(16)); background=surface(MoagilBrand.surface,20) }
        root.addView(rail,LinearLayout.LayoutParams(dp(198),-1).apply { rightMargin=dp(24) })
        rail.addView(View(this),LinearLayout.LayoutParams(1,dp(10)))
        subtitle=label("모아길",21,ink).apply { typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL) }
        rail.addView(LinearLayout(this).apply{gravity=Gravity.CENTER_VERTICAL;addView(MoagilMark(this@FamilyTripActivity),LinearLayout.LayoutParams(dp(34),dp(34)).apply{rightMargin=dp(10)});addView(subtitle,LinearLayout.LayoutParams(0,-2,1f))})
        summary=label("일행의 추천을 기다리고 있어요",13,railText)
        rail.addView(summary)
        rail.addView(View(this),LinearLayout.LayoutParams(1,0,1f))
        rail.addView(label("휴대폰으로 찾고, 차에서 골라요",11,railText))
        rail.addView(button("일행 초대 QR  ↗") { showInvite() }.apply { background=surface(MoagilBrand.mist,13);setTextColor(ink) },LinearLayout.LayoutParams(-1,dp(56)).apply { topMargin=dp(10) })
        rail.addView(railButton("모임 이름 변경") { showTripSettings() },LinearLayout.LayoutParams(-1,dp(50)).apply { topMargin=dp(9) })
        rail.addView(railButton("연결 설정") { showSettings() },LinearLayout.LayoutParams(-1,dp(50)).apply { topMargin=dp(9) })
        rail.addView(railButton("삭제 장소 복원") { restoreDeletedPlace() },LinearLayout.LayoutParams(-1,dp(50)))
        val main=column()
        root.addView(main,LinearLayout.LayoutParams(0,-1,1f))
        val heading=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
        val titles=column()
        titles.addView(label("어디로 갈까요?",27,ink).apply { typeface=Typeface.DEFAULT_BOLD })
        heading.addView(titles,LinearLayout.LayoutParams(0,-2,1f))
        heading.addView(softButton("내비 화면  ↗") { openNavigation() },LinearLayout.LayoutParams(dp(152),dp(52)))
        main.addView(heading)
        status=label("여행방 연결 중…",12,mint).apply { setPadding(dp(12),dp(9),dp(12),dp(9)); background=surface(soft,12) }
        main.addView(status,LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(13);bottomMargin=dp(15) })
        val tools=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
        val filterScroll=HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled=false }
        val filters=LinearLayout(this)
        listOf("all" to "전체", "food" to "맛집", "cafe" to "카페", "trip" to "가볼 곳", "stay" to "숙소", "favorites" to "저장한 곳").forEach { (key,title) ->
            val b=softButton(title) { categoryFilter=key; updateFilters(); renderCards() }
            filterButtons[key]=b
            filters.addView(b,LinearLayout.LayoutParams(-2,dp(46)).apply { rightMargin=dp(7) })
        }
        filterScroll.addView(filters)
        tools.addView(filterScroll,LinearLayout.LayoutParams(0,-2,1f))
        sortButton=softButton(sortLabel()) { showSort() }
        tools.addView(sortButton,LinearLayout.LayoutParams(dp(120),dp(46)).apply { leftMargin=dp(8) })

        toolsRow=tools;main.addView(tools,LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(16) })
        cards=column()
        cardsScroll=ScrollView(this).apply {addView(cards);isFillViewport=true;isVerticalScrollBarEnabled=false};main.addView(cardsScroll,LinearLayout.LayoutParams(-1,0,1f))
        addUndoBar(main)
        addFeatureTabs(main)
        updateFilters()
    }
    private fun buildCompactScreen(){
        window.statusBarColor=canvas
        val root=column().apply {setBackgroundColor(canvas);setPadding(dp(if(slimScreen)14 else 20),dp(if(slimScreen)10 else 13),dp(if(slimScreen)14 else 20),dp(10))}
        setContentView(root)
        val header=LinearLayout(this).apply {gravity=Gravity.CENTER_VERTICAL}
        header.addView(MoagilMark(this),LinearLayout.LayoutParams(dp(if(slimScreen)32 else 38),dp(if(slimScreen)32 else 38)).apply{rightMargin=dp(12)})
        val titles=column()
        subtitle=label("모아길",if(slimScreen)23 else 27,ink).apply {typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END}
        titles.addView(subtitle)
        header.addView(titles,LinearLayout.LayoutParams(0,-2,1f))
        header.addView(softButton("초대 QR") {showInvite()}.apply {textSize=26f},LinearLayout.LayoutParams(dp(95),dp(49)).apply {leftMargin=dp(8)})
        val more=softButton("⋯") { }
        more.contentDescription="여행 관리 메뉴"
        more.setOnClickListener {showTripMenu(more)}
        header.addView(more,LinearLayout.LayoutParams(dp(49),dp(49)).apply {leftMargin=dp(7)})
        root.addView(header)
        val overview=LinearLayout(this).apply {gravity=Gravity.CENTER_VERTICAL}
        summary=label("일행의 추천을 기다리고 있어요",12,muted).apply{maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END}
        overview.addView(summary,LinearLayout.LayoutParams(0,-2,1f))
        overview.addView(softButton("내비 보기 ↗") {openNavigation()},LinearLayout.LayoutParams(dp(122),dp(48)))
        overviewRow=overview
        root.addView(overview,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(if(slimScreen)5 else 9)})
        status=label("모임을 불러오는 중…",11,muted).apply {maxLines=2;setPadding(0,dp(3),0,dp(3))}
        root.addView(status,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(if(slimScreen)5 else 7);bottomMargin=dp(if(slimScreen)8 else 12)})
        val tools=LinearLayout(this).apply{gravity=Gravity.CENTER_VERTICAL}
        val filters=LinearLayout(this)
        listOf("all" to "전체", "favorites" to "저장", "food" to "맛집", "cafe" to "카페", "trip" to "가볼 곳", "stay" to "숙소").forEach{(key,title)->
            val b=softButton(title){categoryFilter=key;updateFilters();renderCards()}
            filterButtons[key]=b
            filters.addView(b,LinearLayout.LayoutParams(-2,dp(48)).apply{rightMargin=dp(6)})
        }
        tools.addView(HorizontalScrollView(this).apply{isHorizontalScrollBarEnabled=true;addView(filters)},LinearLayout.LayoutParams(0,-2,1f))
        sortButton=softButton(sortLabel()){showSort()}
        tools.addView(sortButton,LinearLayout.LayoutParams(dp(112),dp(48)).apply{leftMargin=dp(8)})

        toolsRow=tools;root.addView(tools,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(if(slimScreen)8 else 12)})
        cards=column()
        cardsScroll=ScrollView(this).apply{addView(cards);isFillViewport=true}
        root.addView(cardsScroll,LinearLayout.LayoutParams(-1,0,1f))
        addUndoBar(root)
        addFeatureTabs(root)
        updateFilters()
    }
    private fun sortLabel()=when(sortMode){"distance"->"가까운 순 ▾";"recent"->"최근순 ▾";else->"인기순 ▾"}
    private fun showTripMenu(anchor:View){
        if(!canInteract())return
        lateinit var sheet:AlertDialog
        val content=column().apply{setPadding(dp(20),dp(14),dp(20),dp(10))}
        content.addView(label("모임 설정",20,ink))
        val actions=listOf<Pair<String,()->Unit>>(
            "기본 내비 열기" to {openNavigation()},
            "모임 이름 변경" to {showTripSettings()},
            "최근 삭제 장소 복원" to {restoreDeletedPlace()},
            "개인정보·모임 관리" to {showPrivacy()},
            "사용 방법" to {showHowTo()},
            "고급 설정" to {showSettings()}
        )
        actions.forEachIndexed{i,(title,action)->
            if(i>0)separator(content)
            content.addView(choiceRow(title){sheet.dismiss();action()}.apply{
                if(title=="최근 삭제 장소 복원"&&room?.optBoolean("canUndoPlaceDelete")!=true){isEnabled=false;alpha=.35f}
            })
        }
        sheet=dialog().setView(ScrollView(this).apply{addView(content)}).setNegativeButton("닫기",null).create();sheet.show()
    }
    override fun onConfigurationChanged(newConfig:android.content.res.Configuration){
        super.onConfigurationChanged(newConfig)
        val scroll=if(::cardsScroll.isInitialized)cardsScroll.scrollY else 0
        dismissSheets();MoagilBrand.configure(this);buildScreen();refreshStatus();renderCards()
        cardsScroll.post{cardsScroll.scrollTo(0,scroll)}
    }
    override fun onSaveInstanceState(outState:Bundle){
        outState.putString("activeTab",activeTab);outState.putString("categoryFilter",categoryFilter);outState.putString("sortMode",sortMode)
        outState.putInt("scrollY",if(::cardsScroll.isInitialized)cardsScroll.scrollY else 0)
        super.onSaveInstanceState(outState)
    }
    private fun addFeatureTabs(parent:LinearLayout){
        val row=LinearLayout(this).apply{
            background=surface(MoagilBrand.surface,0);setPadding(dp(6),dp(7),dp(6),dp(3));gravity=Gravity.CENTER_VERTICAL
        }
        listOf("home" to "홈", "places" to "장소", "ballot" to "투표", "course" to "코스").forEach{(key,title)->
            val item=column().apply{gravity=Gravity.CENTER;setOnClickListener{goToTab(key)}}
            val icon=CupertinoTabIcon(this,key).apply{importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO}
            tabIcons[key]=icon;item.addView(icon,LinearLayout.LayoutParams(dp(25),dp(25)))
            val b=softButton(title){goToTab(key)}.apply{
                textSize=22f;setPadding(0,dp(3),0,0);minHeight=dp(30);minimumHeight=dp(30);maxLines=1
            }
            tabButtons[key]=b;item.addView(b,LinearLayout.LayoutParams(-1,dp(30)))
            row.addView(item,LinearLayout.LayoutParams(0,-2,1f))
        }
        parent.addView(row,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(12);bottomMargin=dp(3)})
    }
    private fun supporterText(p:JSONObject,secret:Boolean):String{
        if(secret)return if(room?.optJSONObject("ballot")?.optString("status")=="closed")"결과는 투표 탭에서 확인하세요" else "투표 결과는 투표를 마친 뒤 공개해요"
        val names=p.optJSONArray("supporters")
        val shown=(0 until minOf(4,names?.length() ?: 0)).map{names!!.getString(it)}
        val rest=(p.optInt("votes")-shown.size).coerceAtLeast(0)
        return if(shown.isEmpty())if(p.optInt("votes")==0)"아직 관심 표시가 없어요" else "♥ ${p.optInt("votes")}명 가고 싶어요" else "♥ ${shown.joinToString(" · ")}${if(rest>0)" 외 ${rest}명" else ""}"
    }
    private fun goToTab(tab:String){activeTab=tab;renderCards();cardsScroll.post{cardsScroll.scrollTo(0,0)}}
    private fun choiceRow(title:String,detail:String="",trailing:String="›",selected:Boolean=false,action:()->Unit):LinearLayout{
        val row=LinearLayout(this).apply{
            gravity=Gravity.CENTER_VERTICAL;minimumHeight=dp(if(detail.isEmpty())56 else 70)
            setPadding(0,dp(10),0,dp(10));isClickable=true;isFocusable=true;setOnClickListener{if(canInteract())action()}
        }
        val text=column()
        text.addView(label(title,17,ink).apply{typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL)})
        if(detail.isNotBlank())text.addView(label(detail,12,muted))
        row.addView(text,LinearLayout.LayoutParams(0,-2,1f))
        row.addView(label(if(selected)"✓" else trailing,if(trailing!="›")12 else 22,if(selected||trailing!="›")mint else muted).apply{
            gravity=Gravity.END or Gravity.CENTER_VERTICAL
        },LinearLayout.LayoutParams(-2,-2).apply{leftMargin=dp(12)})
        return row
    }
    private fun separator(parent:LinearLayout){
        parent.addView(View(this).apply{setBackgroundColor(MoagilBrand.line)},LinearLayout.LayoutParams(-1,dp(1)))
    }
    private fun showHowTo(){
        val content=column().apply{setPadding(dp(20),dp(12),dp(20),dp(14))}
        listOf("1. 휴대폰 연결하기" to "차량의 QR 코드를 휴대폰 카메라로 찍으세요.",
            "2. 가고 싶은 곳 추가하기" to "휴대폰에서 장소를 검색해 추가하세요. 함께 갈 사람도 각자 추가할 수 있어요.",
            "3. 차량에서 정하기" to "투표로 한 곳을 고르거나, 여러 곳을 들르는 코스를 만드세요.").forEach{(title,detail)->
            content.addView(label(title,19,ink));content.addView(label(detail,15).apply{setPadding(0,0,0,dp(12))})
        }
        dialog().setTitle("사용 방법").setView(content).setNegativeButton("닫기",null).setPositiveButton("QR 코드 보기"){_,_->showInvite()}.show()
    }
    private fun renderHome(r:JSONObject){
        val step=TripFlow.next(r,connected)
        cards.gravity=Gravity.CENTER
        val hero=column().apply{gravity=Gravity.CENTER_HORIZONTAL;setPadding(dp(16),dp(36),dp(16),dp(52))}
        hero.addView(label(step.title,if(slimScreen)27 else 32,ink).apply{
            gravity=Gravity.CENTER;typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL)
        })
        hero.addView(label(step.hint,15,muted).apply{gravity=Gravity.CENTER;setPadding(0,dp(10),0,dp(30))})
        hero.addView(button(step.button){when(step.action){
            "places"->goToTab("places");"settings"->showSettings();"invite"->showInvite()
            "plan"->showPlanForm();"vote"->confirmOpenBallot();"reveal"->showBallotReveal(r)
            "course"->goToTab("course");"ballot"->goToTab("ballot")
        }},LinearLayout.LayoutParams(dp(if(slimScreen)250 else 280),dp(56)))
        cards.addView(hero,LinearLayout.LayoutParams(-1,-2))
    }
    private fun showPlaceMenu(anchor:View,p:JSONObject){
        if(!canInteract())return
        lateinit var sheet:AlertDialog
        val content=column().apply{setPadding(dp(20),dp(14),dp(20),dp(10))}
        content.addView(label(p.getString("name"),20,ink))
        content.addView(choiceRow("장소 상세 보기"){sheet.dismiss();showPlaceDetails(p)})
        separator(content)
        content.addView(choiceRow("방문 일정 설정"){sheet.dismiss();showTiming(p)})
        separator(content)
        val remove=choiceRow("이 장소 삭제"){sheet.dismiss();confirmDeletePlace(p)}
        (remove.getChildAt(0) as LinearLayout).let{(it.getChildAt(0) as TextView).setTextColor(MoagilBrand.danger)}
        content.addView(remove)
        sheet=dialog().setView(ScrollView(this).apply{addView(content)}).setNegativeButton("닫기",null).create();sheet.show()
    }
    private fun leaveLocalSession(){
        undoPlaceId="";undoUntil=0L;ui.removeCallbacks(expireUndo)
        sessionGeneration++;loading=false
        prefs.edit().remove("roomId").remove("ownerToken").remove("joinToken").remove("cachedRoom").remove("favorites").putBoolean("sessionDetached",true).apply()
        favorites.clear();roomId="";ownerToken="";joinToken="";room=null;revision=-1;connected=false
        dismissSheets();refreshStatus();renderCards()
    }
    private fun showPrivacy(){
        val content=column().apply{setPadding(dp(20),dp(10),dp(20),dp(12))}
        content.addView(label("이름·추천 장소·메모·투표와 코스 진행 기록을 모임 서버에 저장해요. 초대 링크를 가진 사람과 공유되며, 비밀투표 선택은 마감 전 공개하지 않아요.",15))
        content.addView(label("위치는 코스 계산에 사용해요. 카카오 도로 API를 사용할 때 출발·경유 좌표가 전달돼요. 초대 링크는 30일 뒤 만료되며 저장 기록 삭제는 별도예요.",15))
        content.addView(choiceRow("초대 링크 새로 만들기","기존 링크로는 더 이상 참여할 수 없어요."){
            dialog().setTitle("초대 링크를 바꿀까요?").setMessage("기존 참여자는 새 QR로 다시 접속해야 해요.").setNegativeButton("취소",null).setPositiveButton("변경"){_,_->postRoom("session",JSONObject().put("action","rotateInvite")){dismissSheets();showInvite()}}.show()
        })
        separator(content)
        content.addView(choiceRow("모임 참여 종료","기존 휴대폰 링크의 접근을 차단해요. 기록은 보관돼요."){
            dialog().setTitle("모임 참여를 종료할까요?").setNegativeButton("취소",null).setPositiveButton("종료"){_,_->postRoom("session",JSONObject().put("action","close")){dismissSheets()}}.show()
        })
        separator(content)
        content.addView(choiceRow("이 차량에서 모임 나가기","서버 기록은 유지하고 이 차량의 연결 정보를 지워요."){
            dialog().setTitle("이 차량에서 나갈까요?").setMessage("진행자 연결 정보도 지워지므로 이 차량에서 같은 모임을 다시 관리할 수 없어요.").setNegativeButton("취소",null).setPositiveButton("나가기"){_,_->leaveLocalSession()}.show()
        })
        separator(content)
        content.addView(choiceRow("모임 기록 영구 삭제","모든 장소·투표·코스 기록을 삭제해요. 되돌릴 수 없어요."){
            dialog().setTitle("모임 기록을 모두 삭제할까요?").setMessage("참여한 모든 사람의 추천·투표·코스 기록이 서버에서 삭제돼요. 이 작업은 취소할 수 없어요.").setNegativeButton("취소",null).setPositiveButton("삭제"){_,_->postRoom("session",JSONObject().put("action","delete"))}.show()
        })
        dialog().setTitle("개인정보·모임 관리").setView(content).setNegativeButton("닫기",null).show()
    }
    private fun showGleoGuide(){
        val content=column().apply{setPadding(dp(20),dp(10),dp(20),dp(10))}
        content.addView(label("글레오와 모아길 · 시험 단계",21,ink))
        val installed=runCatching{packageManager.getApplicationInfo(GleoActionActivity.GLEO_PACKAGE,0)}.isSuccess
        content.addView(label(if(installed)"이 기기에서 글레오 앱을 찾았어요." else "이 기기에서 지원되는 글레오 앱을 찾지 못했어요.",15,mint))
        content.addView(label("앱 기능 연결은 준비됐어요. 실제 음성 호출은 스키마 등록·승인과 기기 검증이 필요해요.",15))
        content.addView(label("연결할 음성 명령",17,ink))
        listOf("모아길 저장 코스 보여줘","모아길 투표 결과 알려줘","모아길 코스 이어가자").forEach{content.addView(label("· $it",16,ink))}
        content.addView(label("진행 중인 비밀투표 결과는 알려주지 않아요. 코스 이어가기는 화면을 열며, 출발은 직접 확인해 주세요.",14))
        dialog().setView(ScrollView(this).apply{addView(content)}).setPositiveButton("확인",null).show()
    }
    private fun postRoom(action:String,data:JSONObject,done:(JSONObject)->Unit={}){
        if(!canInteract())return
        if(loading||pending!=null){Toast.makeText(this,"연결 또는 안내 요청이 끝난 뒤 다시 시도해 주세요",Toast.LENGTH_SHORT).show();return}
        if(!connected){Toast.makeText(this,"모임 서버 연결을 확인해 주세요",Toast.LENGTH_SHORT).show();return}
        val requestGeneration=sessionGeneration
        loading=true
        if(action=="plan")status.text="코스 계산 중… 잠시 기다려주세요"
        io.execute{
            try{
                val result=request("/api/rooms/$roomId/$action",data)
                ui.post{
                    if(isDestroyed || requestGeneration!=sessionGeneration)return@post
                    if(result.has("joinToken")){joinToken=result.getString("joinToken");SessionStore.put(prefs.edit(),"joinToken",joinToken).apply();result.remove("joinToken")}
                    if(result.optBoolean("deleted")){leaveLocalSession();return@post}
                    room=result;revision=result.getInt("revision");prefs.edit().putString("cachedRoom",result.toString()).apply()
                    loading=false;refreshStatus();renderCards();done(result)
                }
            }catch(e:Exception){ui.post{if(!isDestroyed && requestGeneration==sessionGeneration){refreshStatus();Toast.makeText(this,e.message ?: "저장하지 못했어요",Toast.LENGTH_LONG).show()}}}
            finally{ui.post{if(requestGeneration==sessionGeneration)loading=false}}
        }
    }
    private fun textInput(value:String,hintValue:String="",number:Boolean=false)=EditText(this).apply{
        textSize=28f;setTextColor(ink);setHintTextColor(muted);background=surface(MoagilBrand.background,12)
        setPadding(dp(13),dp(11),dp(13),dp(11));setText(value);hint=hintValue;isSingleLine=true;includeFontPadding=false
        if(number)inputType=android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED
    }
    private fun showTiming(p:JSONObject){
        val content=column().apply{setPadding(dp(18),dp(8),dp(18),dp(10))}
        content.addView(label("지도·매장에 직접 확인한 하루 운영시간을 입력하세요. 휴무와 브레이크타임은 별도 확인이 필요해요.",14))
        val opens=textInput(p.optString("opensAt"),"09:00");val closes=textInput(p.optString("closesAt"),"18:00");val stay=textInput(p.optInt("stayMinutes",60).toString(),number=true)
        content.addView(label("운영 시작 (HH:mm) · 모르면 비워두기",14));content.addView(opens)
        content.addView(label("운영 종료 (HH:mm)",14));content.addView(closes)
        content.addView(label("머무를 시간 (분)",14));content.addView(stay)
        val presets=LinearLayout(this)
        listOf("잠깐 30분" to 30,"식사 1시간" to 60,"여유 2시간" to 120).forEach{(title,minutes)->
            presets.addView(softButton(title){stay.setText(minutes.toString())},LinearLayout.LayoutParams(0,dp(48),1f).apply{rightMargin=dp(5)})
        }
        content.addView(presets)
        val required=CupertinoToggle(this).apply{text="코스에 꼭 포함하기";textSize=28f;setTextColor(ink);isChecked=p.optBoolean("mustVisit")}
        content.addView(required)
        dialog().setTitle("${p.getString("name")} · 방문 조건").setView(ScrollView(this).apply{addView(content)}).setNegativeButton("닫기",null).setPositiveButton("저장"){_,_->
            val duration=stay.text.toString().toIntOrNull()
            if(duration==null){Toast.makeText(this,"머무를 시간을 확인해 주세요",Toast.LENGTH_LONG).show();return@setPositiveButton}
            postRoom("timing",JSONObject().put("placeId",p.getString("id")).put("opensAt",opens.text.toString().trim()).put("closesAt",closes.text.toString().trim()).put("stayMinutes",duration).put("mustVisit",required.isChecked))
        }.show()
    }
    private fun showPlanForm(remaining:Boolean=false){
        runCatching{navi?.getCurrentLocationInfo()}
        val content=column().apply{setPadding(dp(18),dp(10),dp(18),dp(12))}
        content.addView(label("출발할 곳을 고르고 코스를 비교해 보세요.",15))
        val location=validLocation()
        val lat=textInput(location?.latitude?.toString() ?: "","위도",true)
        val lon=textInput(location?.longitude?.toString() ?: "","경도",true)
        val originTitle=label(if(location!=null)"현재 위치" else "출발할 곳을 선택하세요",18,ink)
        content.addView(originTitle)
        content.addView(softButton("출발 위치 바꾸기"){
            val locations=mutableListOf<Pair<String,Pair<Double,Double>>>()
            validLocation()?.let{locations.add("현재 위치" to (it.latitude to it.longitude))}
            val places=room?.optJSONArray("places")
            for(i in 0 until (places?.length() ?: 0)){
                val p=places!!.getJSONObject(i)
                if(!p.optBoolean("demo"))locations.add(p.getString("name") to (p.getDouble("latitude") to p.getDouble("longitude")))
            }
            if(locations.isEmpty()){Toast.makeText(this,"위치를 확인하고 있어요. 잠시 후 다시 눌러주세요.",Toast.LENGTH_LONG).show()}
            else dialog().setTitle("어디서 출발하나요?").setItems(locations.map{it.first}.toTypedArray()){_,which->
                val choice=locations[which];lat.setText(choice.second.first.toString());lon.setText(choice.second.second.toString());originTitle.text=choice.first
            }.setNegativeButton("취소",null).show()
        })
        val formatter=java.time.format.DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm")
        val start=textInput(java.time.LocalDateTime.now(java.time.ZoneId.of("Asia/Seoul")).format(formatter))
        content.addView(label("지금 출발 · 출발 시간은 세부 설정에서 바꿀 수 있어요.",14))
        val places=room?.optJSONArray("places")
        val realCount=(0 until (places?.length() ?: 0)).count{!places!!.getJSONObject(it).optBoolean("demo")}
        val count=textInput(minOf(3,realCount).coerceAtLeast(1).toString(),number=true)
        val estimate=textInput("20",number=true)
        if(!remaining){
            content.addView(label("몇 곳까지 들를까요?",18,ink))
            val presets=LinearLayout(this)
            for(n in 1..realCount.coerceIn(1,5))presets.addView(softButton("${n}곳"){count.setText(n.toString());for(j in 0 until presets.childCount){val b=presets.getChildAt(j) as Button;b.background=surface(if(j+1==n)soft else Color.TRANSPARENT,10)}}.apply{background=surface(if(n==count.text.toString().toInt())soft else Color.TRANSPARENT,10)},LinearLayout.LayoutParams(0,dp(48),1f))
            content.addView(presets)
        }
        content.addView(label(if(roadRoutingEnabled)"도로 예상시간과 입력한 영업시간을 참고해요." else "이동 시간은 직접 정한 예상값으로 계산해요.",14))
        val advanced=column().apply{visibility=View.GONE}
        content.addView(softButton("세부 설정 보기"){
            advanced.visibility=if(advanced.visibility==View.VISIBLE)View.GONE else View.VISIBLE
        })
        advanced.addView(label("출발 시간 (예: 2026-10-27 10:00)",14));advanced.addView(start)
        advanced.addView(label("출발 좌표 직접 입력",14));advanced.addView(lat);advanced.addView(lon)
        if(!remaining){advanced.addView(label("최대 방문 수 (1~5)",14));advanced.addView(count)}
        advanced.addView(label("도로시간을 못 받을 때 사용할 구간당 이동시간 (분)",14));advanced.addView(estimate)
        content.addView(advanced)
        val form=dialog().setTitle(if(remaining)"남은 코스 다시 짜기" else "여행 코스 만들기").setView(content).setNegativeButton("취소",null).setPositiveButton("코스 비교",null).create()
        form.setOnShowListener{form.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
            if(!canInteract())return@setOnClickListener
            val latitude=lat.text.toString().toDoubleOrNull();val longitude=lon.text.toString().toDoubleOrNull()
            if(latitude==null||longitude==null||latitude !in -90.0..90.0||longitude !in -180.0..180.0){Toast.makeText(this,"출발할 곳을 먼저 선택해 주세요.",Toast.LENGTH_LONG).show();return@setOnClickListener}
            val max=count.text.toString().toIntOrNull();val assumed=estimate.text.toString().toIntOrNull()
            val date=runCatching{java.time.LocalDateTime.parse(start.text.toString().trim(),formatter.withResolverStyle(java.time.format.ResolverStyle.STRICT)).atZone(java.time.ZoneId.of("Asia/Seoul")).toInstant().toString()}.getOrNull()
            if(max==null||max !in 1..5||assumed==null||assumed !in 1..240||date==null){Toast.makeText(this,"세부 설정의 시간과 방문 수를 확인해 주세요.",Toast.LENGTH_LONG).show();return@setOnClickListener}
            postRoom("plan",JSONObject().put("origin",JSONObject().put("latitude",latitude).put("longitude",longitude)).put("startAt",date).put("maxStops",max).put("assumedMinutes",assumed).put("remainingOnly",remaining)){form.dismiss()}
        }}
        form.show()
    }
    private fun featureCard(title:String,description:String=""):LinearLayout{
        val view=column().apply{setPadding(dp(16),dp(13),dp(16),dp(13));background=surface(MoagilBrand.surface,17)}
        view.addView(label(title,18,ink).apply{typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL)})
        if(description.isNotBlank())view.addView(label(description,14))
        cards.addView(view,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(12)})
        return view
    }
    private fun timeLabel(iso:String)=runCatching{java.time.Instant.parse(iso).atZone(java.time.ZoneId.of("Asia/Seoul")).format(java.time.format.DateTimeFormatter.ofPattern("MM/dd HH:mm"))}.getOrDefault("확인 필요")
    private fun renderCoursePane(r:JSONObject){
        val course=r.optJSONObject("course")
        if(course!=null){
            val stops=course.getJSONArray("stops");val index=course.optInt("nextIndex")
            val pane=featureCard(if(index<stops.length())"저장한 코스 이어가기" else "모든 방문을 마쳤어요 ✓","${course.getString("title")} · ${index}/${stops.length()}곳 진행")
            pane.addView(label(if(course.optString("timingSource")=="kakao-road")"조회 당시 도로 예상시간 기준" else "직접 설정한 임시 이동시간 기준 · 실제 도로시간 아님",12,mint))
            if(index<stops.length()){
                val next=stops.getJSONObject(index)
                pane.addView(label("다음 · ${next.getString("name")}",24,ink))
                pane.addView(label("저장한 도착 계획 ${timeLabel(next.getString("startVisitAt"))} · 다시 출발할 때 운영시간을 확인하세요.",13))
                pane.addView(button("코스 이어서 출발"){confirmCourseRoute(course)}.apply{isEnabled=naviReady && pending==null})
                val controls=LinearLayout(this)
                controls.addView(softButton("방문 완료"){confirmProgress(next,"visit")},LinearLayout.LayoutParams(0,dp(50),1f).apply{rightMargin=dp(6)})
                controls.addView(softButton("건너뛰기"){confirmProgress(next,"skip")},LinearLayout.LayoutParams(0,dp(50),1f))
                pane.addView(controls,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(8)})
            }
            val timeline=column().apply{visibility=View.GONE}
            val links=LinearLayout(this)
            lateinit var timelineButton:Button
            timelineButton=softButton("전체 일정 보기"){
                val open=timeline.visibility!=View.VISIBLE
                timeline.visibility=if(open)View.VISIBLE else View.GONE
                timelineButton.text=if(open)"일정 접기" else "전체 일정 보기"
            }
            links.addView(timelineButton,LinearLayout.LayoutParams(0,dp(48),1f))
            links.addView(softButton("일정 관리"){showCourseMenu(course)},LinearLayout.LayoutParams(0,dp(48),1f))
            pane.addView(links)
            for(i in 0 until stops.length()){
                val p=stops.getJSONObject(i);val state=when(p.optString("status")){"visited"->"✓ 방문 완료";"skipped"->"건너뜀";else->if(i==index)"다음" else "예정"}
                val row=LinearLayout(this).apply{gravity=Gravity.TOP;setPadding(0,dp(8),0,dp(4))}
                row.addView(label(if(p.optString("status")=="visited")"✓" else "${i+1}",16,if(i==index)Color.WHITE else mint).apply{
                    gravity=Gravity.CENTER;background=surface(if(i==index)mint else soft,12)
                },LinearLayout.LayoutParams(dp(34),dp(34)).apply{rightMargin=dp(10)})
                val text=column()
                text.addView(label("${p.getString("name")} · $state",15,ink))
                if(p.optString("status")=="planned")text.addView(label("계획 ${timeLabel(p.optString("startVisitAt"))} · 머무름 ${p.optInt("stayMinutes",60)}분",12))
                row.addView(text,LinearLayout.LayoutParams(0,-2,1f));timeline.addView(row)
                if(i<stops.length()-1)timeline.addView(label("↓  이동 약 ${stops.getJSONObject(i+1).optInt("legMinutes")}분 · 저장한 계획 기준",12))
            }
            pane.addView(timeline)
        }
        val intro=featureCard("새 코스 만들기","이동 시간과 가고 싶은 곳을 참고해 순서를 정해요. 영업시간은 직접 확인해 주세요.")
        intro.addView(button("코스 만들기"){showPlanForm()})
        val plans=r.optJSONArray("plans") ?: return
        for(i in 0 until plans.length()){
            val p=plans.getJSONObject(i);val stops=p.getJSONArray("stops")
            val option=featureCard(p.getString("title"),p.getString("reason"))
            option.addView(label(if(p.optString("timingSource")=="kakao-road")"도로 ${p.optDouble("roadDistanceKm")}km · 이동 약 ${p.optInt("roadMinutes")}분" else "직선 연결 ${p.optDouble("straightKm")}km · 구간당 임시 ${p.optInt("assumedMinutes")}분",13,mint))
            for(j in 0 until stops.length()){val s=stops.getJSONObject(j);option.addView(label("${j+1}. ${s.getString("name")} · ${timeLabel(s.getString("startVisitAt"))}",15,ink))}
            val warnings=p.optJSONArray("warnings")
            if(warnings!=null)for(j in 0 until warnings.length())option.addView(label("· ${warnings.getString(j)}",12,MoagilBrand.warning))
            val save=button(if(p.optInt("violations")>0)"운영시간을 조정해 주세요" else "이 코스 저장하기"){dialog().setTitle("코스를 저장할까요?").setMessage("현재 저장한 코스를 이 코스로 바꿉니다. 시동을 꺼도 방문 순서를 이어갈 수 있어요. 실제 안내는 출발 전에 다시 확인하세요.").setNegativeButton("돌아가기",null).setPositiveButton("저장"){_,_->postRoom("course",JSONObject().put("action","choose").put("planId",p.getString("id")))}.show()}
            save.isEnabled=p.optInt("violations")==0;option.addView(save)
        }
    }
    private fun showCourseMenu(course:JSONObject){
        lateinit var sheet:AlertDialog
        val content=column().apply{setPadding(dp(20),dp(12),dp(20),dp(12))}
        val stops=course.getJSONArray("stops");val index=course.optInt("nextIndex")
        if(index<stops.length()){
            content.addView(choiceRow("다음 장소만 안내"){sheet.dismiss();confirmRoute(JSONObject(stops.getJSONObject(index).toString()).put("id",stops.getJSONObject(index).getString("placeId")))})
            separator(content)
            content.addView(choiceRow("남은 일정 다시 계산"){sheet.dismiss();showPlanForm(true)})
        }
        if(index>0){
            if(content.childCount>0)separator(content)
            content.addView(choiceRow("이전 방문 처리 되돌리기"){sheet.dismiss();postRoom("course",JSONObject().put("action","undo"))})
        }
        if(content.childCount==0)content.addView(label("아직 변경할 일정이 없어요",15))
        sheet=dialog().setTitle("일정 관리").setView(content).setNegativeButton("닫기",null).create();sheet.show()
    }
    private fun confirmProgress(stop:JSONObject,action:String){
        dialog().setTitle(if(action=="visit")"이 장소 방문을 마쳤나요?" else "이 장소를 건너뛸까요?").setMessage(stop.getString("name")+"\n방문 기록만 변경하며, 다음 목적지 안내는 직접 선택합니다.").setNegativeButton("돌아가기",null).setPositiveButton("확인"){_,_->postRoom("course",JSONObject().put("action",action).put("placeId",stop.getString("placeId")))}.show()
    }
    private fun renderBallotPane(r:JSONObject){
        val b=r.optJSONObject("ballot")
        if(b==null){
            val pane=featureCard("오늘은 딱 한 곳만 고른다면?","식사, 카페, 친구와의 약속처럼 한 곳을 정할 때 비밀 투표를 열어보세요. 종료 전에는 진행자도 득표와 선택자를 볼 수 없어요.")
            pane.addView(label("한 기기에서 한 표씩 · 투표를 마치기 전에는 바꿀 수 있어요",13,mint))
            pane.addView(button("비밀 투표 열기"){confirmOpenBallot()})
        }else{
            val pane=featureCard(if(b.getString("status")=="open")"투표하고 있어요" else "투표 결과","${b.optInt("castCount")}명 참여${if(b.getString("status")=="open")" · 결과는 투표를 마친 뒤 공개해요" else ""}")
            if(b.getString("status")=="open"){
                pane.addView(label("초대 QR로 참여한 휴대폰에서 후보를 고르세요.",15))
                pane.addView(button("투표 마치기"){dialog().setTitle("투표를 종료할까요?").setMessage("종료 후에는 선택을 바꿀 수 없어요. 모두 참여했는지 확인해 주세요.").setNegativeButton("돌아가기",null).setPositiveButton("종료"){_,_->postRoom("ballot",JSONObject().put("action","close")){showBallotReveal(it)}}.show()})
            }else{
                pane.addView(button("결과 보기"){showBallotReveal(r)})
                pane.addView(softButton("새 투표 준비"){confirmClearBallot()})
            }
        }

    }
    private fun confirmClearBallot(){
        dialog().setTitle("새 투표를 준비할까요?").setMessage("지난 투표 결과는 지워지고, 추가한 장소는 그대로 남아요.")
            .setNegativeButton("취소",null).setPositiveButton("새로 시작"){_,_->postRoom("ballot",JSONObject().put("action","clear"))}.show()
    }
    private fun confirmOpenBallot(){
        val places=room?.optJSONArray("places")
        if((0 until (places?.length() ?: 0)).count{!places!!.getJSONObject(it).optBoolean("demo")}<2){
            Toast.makeText(this,"장소를 두 곳 이상 추가하면 투표할 수 있어요",Toast.LENGTH_LONG).show();return
        }
        dialog().setTitle("투표를 시작할까요?").setMessage("지금 추가한 장소로 투표해요. 투표를 마칠 때까지는 누가 앞서는지 알 수 없어요.")
            .setNegativeButton("돌아가기",null).setPositiveButton("시작하기"){_,_->postRoom("ballot",JSONObject().put("action","open"))}.show()
    }
    private fun showBallotReveal(r:JSONObject){
        val ballot=r.optJSONObject("ballot") ?: return
        if(ballot.optString("status")!="closed")return
        val box=column().apply{setPadding(dp(20),dp(12),dp(20),dp(12));gravity=Gravity.CENTER_HORIZONTAL}
        val stage=label("🥁",42,mint).apply{gravity=Gravity.CENTER}
        val title=label("가장 많은 표를 받은 곳은?",22,ink).apply{gravity=Gravity.CENTER}
        val sound=CupertinoToggle(this).apply{text="효과음 켜기";textSize=26f;setTextColor(ink)}
        val animationArea=FrameLayout(this)
        animationArea.addView(stage,FrameLayout.LayoutParams(-1,dp(100)))
        box.addView(animationArea);box.addView(title);box.addView(sound)
        val reveal=dialog().setTitle("우리의 선택").setView(ScrollView(this).apply{addView(box)}).setNegativeButton("닫기",null).setPositiveButton("결과 공개",null).create()
        val fx=Handler(Looper.getMainLooper());var tone:ResultSound?=null;var animator:android.animation.ValueAnimator?=null
        resultSheet=reveal
        reveal.setOnShowListener{
            reveal.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
                if(!canInteract())return@setOnClickListener
                it.isEnabled=false;stage.text="두구두구…";title.text="잠시만요…"
                if(sound.isChecked){tone=ResultSound(this).takeIf{it.acquire()};for(i in 0..6)fx.postDelayed({tone?.play(android.media.ToneGenerator.TONE_PROP_BEEP,60)},i*140L)}
                fx.postDelayed({
                    val ids=ballot.getJSONArray("winnerIds");val places=r.getJSONArray("places")
                    val names=(0 until ids.length()).map{idIndex->(0 until places.length()).map{places.getJSONObject(it)}.firstOrNull{it.getString("id")==ids.getString(idIndex)}?.optString("name") ?: ballot.optJSONObject("candidateNames")?.optString(ids.getString(idIndex),"삭제된 장소") ?: "삭제된 장소"}
                    stage.text="🎉";title.text=(if(names.size>1)"공동 1위!\n" else "오늘은 여기로!\n")+names.joinToString("\n")
                    if(sound.isChecked){tone?.play(android.media.ToneGenerator.TONE_PROP_ACK,450)}
                    fx.postDelayed({tone?.close()},600)
                    if(android.animation.ValueAnimator.areAnimatorsEnabled()){
                        val confetti=object:View(this){val paint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);var progress=0f
                            override fun onDraw(c:android.graphics.Canvas){for(i in 0..25){paint.color=listOf(mint,Color.rgb(229,145,85),Color.rgb(181,206,148))[i%3];val x=width*((i*37%100)/100f);val y=height*((progress+(i%5)*.1f)%1f);c.drawCircle(x,y,dp(3).toFloat(),paint)}}}
                        animationArea.addView(confetti,FrameLayout.LayoutParams(-1,-1))
                        animator=android.animation.ValueAnimator.ofFloat(0f,1f).apply{duration=1500;addUpdateListener{confetti.progress=it.animatedValue as Float;confetti.invalidate()};start()}
                    }
                },if(android.animation.ValueAnimator.areAnimatorsEnabled())1200 else 0)
            }
        }
        reveal.setOnDismissListener{fx.removeCallbacksAndMessages(null);tone?.close();animator?.cancel();resultSheet=null}
        reveal.show()
    }

    private fun surface(color:Int,radius:Int)=GradientDrawable().apply { setColor(color);cornerRadius=dp(radius).toFloat() }
    private fun softButton(value:String,action:()->Unit)=button(value,action).apply { setTextColor(mint); background=surface(Color.TRANSPARENT,10);textSize=26f }
    private fun railButton(value:String,action:()->Unit)=softButton(value,action).apply {setTextColor(mint);background=surface(Color.TRANSPARENT,12);gravity=Gravity.START or Gravity.CENTER_VERTICAL}
    private fun dialog()=CupertinoSheetBuilder(this,{canInteract()}){sheets.removeAll{old->!old.isShowing};sheets.add(it)}
    private fun journeyIllustration()=object:View(this){
        private val paint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(c:android.graphics.Canvas){
            super.onDraw(c)
            val w=width.toFloat();val h=height.toFloat()
            c.save();c.clipPath(android.graphics.Path().apply {addRoundRect(android.graphics.RectF(0f,0f,w,h),dp(17).toFloat(),dp(17).toFloat(),android.graphics.Path.Direction.CW)})
            paint.color=Color.rgb(216,226,197);c.drawRoundRect(0f,0f,w,h,dp(17).toFloat(),dp(17).toFloat(),paint)
            paint.color=Color.rgb(223,163,112);c.drawCircle(w*.26f,h*.29f,h*.12f,paint)
            paint.color=Color.rgb(176,197,153);c.drawOval(w*.2f,h*.4f,w*1.45f,h*1.5f,paint)
            paint.color=Color.rgb(127,161,128);c.drawOval(-w*.4f,h*.62f,w*.8f,h*1.6f,paint)
            paint.style=android.graphics.Paint.Style.STROKE;paint.strokeWidth=h*.12f;paint.color=Color.rgb(249,240,214)
            val path=android.graphics.Path().apply {moveTo(w*.7f,h*1.1f);cubicTo(w*.2f,h*.75f,w*1.2f,h*.7f,w*.6f,h*.4f)}
            c.drawPath(path,paint);paint.style=android.graphics.Paint.Style.FILL
            c.save();c.rotate(-18f,w*.65f,h*.73f);paint.color=mint;c.drawRoundRect(w*.55f,h*.65f,w*.75f,h*.81f,h*.04f,h*.04f,paint);c.restore()
            c.restore()
        }
    }
    private fun updateFilters(){ filterButtons.forEach { (key,b) -> b.setTextColor(if(key==categoryFilter) mint else muted);b.background=surface(if(key==categoryFilter) soft else MoagilBrand.background,12);b.isSelected=key==categoryFilter } }
    private fun showSort(){
        dialog().setTitle("장소 비교 기준").setSingleChoiceItems(arrayOf("일행 인기순", "가까운 순 · 직선 거리", "최근 추가순"),listOf("votes","distance","recent").indexOf(sortMode)){dialog,which ->
            if(which==1 && validLocation()==null){Toast.makeText(this,"현재 위치를 받은 뒤 사용할 수 있어요",Toast.LENGTH_LONG).show();return@setSingleChoiceItems}
            sortMode=listOf("votes","distance","recent")[which]
            sortButton.text=listOf("인기순 ▾","가까운 순 ▾","최근순 ▾")[which]
            renderCards();dialog.dismiss()
        }.setNegativeButton("닫기",null).show()
    }
    private fun validLocation()=currentLocation?.takeIf { android.os.SystemClock.elapsedRealtime()-locationReceivedAt<120000 && it.latitude.isFinite() && it.longitude.isFinite() && abs(it.latitude)<=90 && abs(it.longitude)<=180 && (it.latitude!=0.0 || it.longitude!=0.0) }
    private fun showTripSettings(){
        if(loading || pending!=null){Toast.makeText(this,"연결 또는 내비 요청이 끝난 뒤 다시 시도해 주세요",Toast.LENGTH_SHORT).show();return}
        if(!connected){Toast.makeText(this,"여행방에 연결한 뒤 이름을 바꿀 수 있어요",Toast.LENGTH_SHORT).show();return}
        val input=textInput(room?.optString("name") ?: "우리의 모임").apply { filters=arrayOf(android.text.InputFilter.LengthFilter(40)) }
        val layout=column().apply { setPadding(dp(20),dp(10),dp(20),dp(10));addView(label("함께 알아보기 쉬운 이름을 지어주세요.",16));addView(input) }
        dialog().setTitle("모임 이름").setView(layout).setNegativeButton("닫기",null).setPositiveButton("저장"){_,_->
            val name=input.text.toString().trim()
            if(name.isBlank()){Toast.makeText(this,"모임 이름을 입력해 주세요",Toast.LENGTH_SHORT).show();return@setPositiveButton}
            if(loading || pending!=null)return@setPositiveButton
            loading=true
            io.execute {
                try { request("/api/rooms/$roomId/settings",JSONObject().put("name",name));ui.post { Toast.makeText(this,"모임 이름을 바꿨어요",Toast.LENGTH_SHORT).show() } }
                catch(e:Exception){ui.post { Toast.makeText(this,"이름을 저장하지 못했어요. 연결을 확인해 주세요",Toast.LENGTH_LONG).show() }}
                finally { ui.post { loading=false;sync() } }
            }
        }.show()
    }
    private fun baseUrl() = prefs.getString("serverUrl", BuildConfig.DEFAULT_SERVER_URL)!!.trimEnd('/')
    private fun request(path: String, data: JSONObject? = null): JSONObject {
        val c = URL(baseUrl() + path).openConnection() as HttpURLConnection
        c.instanceFollowRedirects=false
        require(BuildConfig.DEBUG || URI(baseUrl()).scheme=="https"){"보안 연결 주소가 필요합니다."}
        c.connectTimeout = 5000; c.readTimeout = if(path.endsWith("/plan"))30000 else 7000
        if (ownerToken.isNotBlank()) c.setRequestProperty("Authorization", "Bearer $ownerToken")
        try {
            if (data != null) {
                c.requestMethod = "POST"; c.doOutput = true; c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(data.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val result = JSONObject(stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}")
            if (code !in 200..299) throw IllegalStateException(result.optString("error", "연결 오류 $code"))
            return result
        } finally { c.disconnect() }
    }

    private fun sync() {
        if(prefs.getBoolean("sessionDetached",false))return
        if (loading) return
        val requestGeneration=sessionGeneration
        loading = true
        io.execute {
            try {
                val config = request("/api/config")
                val created = roomId.isBlank()
                val result = if (created) request("/api/rooms", JSONObject().put("name", "우리의 모임")) else request("/api/rooms/$roomId")
                ui.post {
                    if (isDestroyed || requestGeneration!=sessionGeneration) return@post
                    val sharingChanged=localOnly!=config.getBoolean("localOnly") || publicUrl!=config.getString("publicUrl")
                    publicUrl = config.getString("publicUrl"); localOnly = config.getBoolean("localOnly");roadRoutingEnabled=config.optBoolean("roadRoutingEnabled")
                    if (created) {
                        roomId = result.getString("id"); ownerToken = result.getString("ownerToken"); joinToken = result.getString("joinToken")
                        SessionStore.put(SessionStore.put(prefs.edit().putString("roomId",roomId),"ownerToken",ownerToken),"joinToken",joinToken).apply()
                    }
                    result.remove("ownerToken");result.remove("joinToken")
                    connected=true
                    lastSync=java.text.SimpleDateFormat("HH:mm",java.util.Locale.KOREA).format(java.util.Date())
                    if (revision != result.getInt("revision")) prefs.edit().putString("cachedRoom",result.toString()).apply()
                    room = result
                    subtitle.text = "모아길"
                    refreshStatus()
                    if (revision != result.getInt("revision")||sharingChanged) { revision = result.getInt("revision"); renderCards() }
                }
            } catch (e: Exception) { ui.post { if (!isDestroyed && requestGeneration==sessionGeneration) { connected=false;refreshStatus();renderCards() } } }
            finally { ui.post { if(requestGeneration==sessionGeneration)loading = false } }
        }
    }

    private fun refreshStatus() {
        if(!::status.isInitialized)return
                status.text=if(connected){
            if(pending!=null||navigationStatus.contains("오류")||navigationStatus.contains("실패")||navigationStatus.contains("확인"))navigationStatus else "함께 갈 곳을 골라보세요"
        }else if(slimScreen) "재연결 중 · 마지막 받은 장소" else "여행방 연결 대기 · 마지막 받은 장소 표시 · 서버를 확인해 주세요"
        status.contentDescription=if(connected)"$navigationStatus. 여행방 연결됨. $lastSync 갱신" else "여행방 연결 대기. 마지막으로 받은 장소를 표시합니다."
        status.setTextColor(if(connected) mint else MoagilBrand.warning)
        status.visibility=if(!connected||pending!=null||navigationStatus.contains("오류")||navigationStatus.contains("실패")||navigationStatus.contains("확인"))View.VISIBLE else View.GONE
    }
    private fun renderCards() {
        if(!::cards.isInitialized)return
        updateUndoBar()
        cards.removeAllViews()
        cards.gravity=Gravity.TOP
        overviewRow?.visibility=if(activeTab=="home")View.GONE else View.VISIBLE
        if(!safety.allowed){
            toolsRow.visibility=View.GONE
            cards.addView(label("주차 후 이용해 주세요",24,ink))
            cards.addView(label("차량의 주행 제한 상태를 확인하고 있어요. 주행 중에는 기본 내비 안내를 이용해 주세요.",16))
            return
        }
        if(prefs.getBoolean("sessionDetached",false)){
            toolsRow.visibility=View.GONE
            cards.addView(label("모임에서 나왔어요",24,ink))
            cards.addView(button("새 모임 만들기"){prefs.edit().putBoolean("sessionDetached",false).apply();sync()})
            return
        }
        val r=room
        if(r==null){cards.addView(label("모임을 불러오고 있어요",24,ink));cards.addView(label("잠시만 기다려 주세요. 연결되면 추천 장소가 나타나요.",17));return}
        subtitle.text="모아길"
        val source=r.getJSONArray("places")
        val all=(0 until source.length()).map { source.getJSONObject(it) }
        val ballot=r.optJSONObject("ballot")
        summary.text=if(ballot!=null)"비밀 투표 · ${ballot.optInt("castCount")}명 참여" else "장소 ${all.size}곳"
        toolsRow.visibility=if(activeTab=="places")View.VISIBLE else View.GONE
        tabButtons.forEach{(key,b)->b.background=surface(Color.TRANSPARENT,0);b.setTextColor(if(key==activeTab)mint else muted);b.isSelected=key==activeTab;tabIcons[key]?.active=key==activeTab}
        if(activeTab=="home"){renderHome(r);return}
        if(activeTab=="course"){renderCoursePane(r);return}
        if(activeTab=="ballot"){renderBallotPane(r);return}
        var sorted=all.filter { categoryFilter=="all" || if(categoryFilter=="favorites") favorites.contains(it.getString("id")) else it.optString("category")==categoryFilter }
        sorted=when(sortMode){
            "recent" -> sorted.sortedByDescending { it.optLong("createdAt") }
            "distance" -> validLocation()?.let { location -> sorted.sortedBy { distanceKm(location.latitude,location.longitude,it.getDouble("latitude"),it.getDouble("longitude")) } } ?: sorted
            else -> sorted.sortedWith(compareByDescending<JSONObject> { it.optInt("votes") }.thenBy { it.optLong("createdAt") })
        }
        if(sorted.isEmpty()){
            val empty=column().apply { setPadding(dp(28),dp(30),dp(28),dp(25));background=surface(MoagilBrand.surface,20) }
            empty.addView(label("↗",42,mint))
            empty.addView(label(if(all.isEmpty()) "가고 싶은 곳을 추가해 보세요" else "이 분류에는 아직 장소가 없어요",23,ink))
            empty.addView(label(if(categoryFilter=="favorites") "장소 카드의 저장 버튼을 눌러\n다음에 가고 싶은 곳을 따로 모아보세요." else "QR로 휴대폰을 연결하고\n가고 싶은 곳을 추가해 보세요.",16))
            if(all.isEmpty())empty.addView(button("일행 초대 QR 열기") {showInvite()})
            cards.addView(empty);return
        }
        val columns=if(windowUnits-(if(compactScreen)40 else 262)>=720)2 else 1
        var row:LinearLayout?=null
        sorted.forEachIndexed { index,p ->
            if(index%columns==0){row=LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL };cards.addView(row,LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(14) })}
            val selected=r.optString("selectedId")==p.getString("id")
            val card=column().apply { setPadding(dp(if(compactScreen)15 else 18),dp(if(compactScreen)12 else 15),dp(if(compactScreen)15 else 18),dp(if(compactScreen)12 else 15));background=GradientDrawable().apply {setColor(MoagilBrand.surface);cornerRadius=dp(18).toFloat();setStroke(dp(1),if(selected)MoagilBrand.activeBlue else MoagilBrand.line)} }
            row!!.addView(card,LinearLayout.LayoutParams(0,-2,1f).apply { if(index%columns==0 && columns==2) rightMargin=dp(12) })
            val category=when(p.optString("category")){"food"->"맛집";"cafe"->"카페";"trip"->"가볼 곳";"stay"->"숙소";else->"추천 장소"}
                        val top=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL;setPadding(0,0,0,dp(if(slimScreen)0 else 9)) }
            val categoryIcon=when(p.optString("category")){"food"->"食";"cafe"->"☕";"trip"->"↗";"stay"->"⌂";else->"⌖"}
            if(!slimScreen)top.addView(label(categoryIcon,19,mint).apply { gravity=Gravity.CENTER;background=surface(soft,11) },LinearLayout.LayoutParams(dp(39),dp(39)).apply{rightMargin=dp(10)})
            top.addView(label(if(selected)"선택한 목적지" else if(p.optBoolean("demo")) "연동 시험 · ${index+1}" else "$category  ·  ${index+1}",12,mint),LinearLayout.LayoutParams(0,-2,1f))
            card.addView(top)
            card.addView(label(p.getString("name"),if(compactScreen)20 else 23,ink).apply {
                typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);maxLines=2;ellipsize=android.text.TextUtils.TruncateAt.END
                isClickable=true;isFocusable=true;contentDescription="${p.getString("name")} 상세 보기"
                setOnClickListener{if(canInteract())showPlaceDetails(p)}
            })
            validLocation()?.let{location->card.addView(label("직선 %.1f km".format(distanceKm(location.latitude,location.longitude,p.getDouble("latitude"),p.getDouble("longitude"))),13,muted))}
            val actions=LinearLayout(this)
            val save=softButton(if(favorites.contains(p.getString("id"))) "★ 저장됨" else "☆ 저장") {
                val id=p.getString("id");if(!favorites.add(id))favorites.remove(id)
                prefs.edit().putStringSet("favorites",favorites.toSet()).apply();renderCards()
            }
                        if(compactScreen){save.text=if(favorites.contains(p.getString("id")))"★" else "☆";save.contentDescription=if(favorites.contains(p.getString("id")))"저장 취소" else "장소 저장"}
            actions.addView(save,LinearLayout.LayoutParams(dp(if(compactScreen)52 else 108),dp(52)).apply{rightMargin=dp(7)})
            val more=softButton("⋯"){}
            more.contentDescription="${p.getString("name")} 관리 메뉴"
            more.setOnClickListener{showPlaceMenu(more,p)}
            actions.addView(more,LinearLayout.LayoutParams(dp(52),dp(52)).apply{rightMargin=dp(7)})
            val voting=ballot?.optString("status")=="open"
            actions.addView(softButton(if(voting)"투표 보기" else if(pending?.optString("id")==p.getString("id"))"확인 중…" else "출발") {
                if(voting)goToTab("ballot") else confirmRoute(p)
            }.apply{isEnabled=if(voting)true else naviReady&&pending==null},LinearLayout.LayoutParams(0,dp(52),1f))
            if(ballot==null)card.addView(label(supporterText(p,false),12,mint).apply{maxLines=2;ellipsize=android.text.TextUtils.TruncateAt.END})
            card.addView(actions,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(if(slimScreen)8 else 12)})
        }
        if(columns==2 && sorted.size%2==1)row!!.addView(View(this),LinearLayout.LayoutParams(0,1,1f))
        if(restoredScroll>0){val y=restoredScroll;restoredScroll=0;cardsScroll.post{cardsScroll.scrollTo(0,y)}}
    }
    private fun showPlaceDetails(p:JSONObject){
        lateinit var detail:AlertDialog
        val content=column().apply{setPadding(dp(18),dp(9),dp(18),dp(12))}
        content.addView(label(p.optString("address","주소 정보 없음"),16,ink))
        if(p.optString("note").isNotBlank())content.addView(label(p.getString("note"),16,ink))
        content.addView(label("${p.getString("sender")}의 추천 · ${supporterText(p,room?.optJSONObject("ballot")!=null)}",14))
        content.addView(label(if(p.optString("opensAt").isNotBlank())"운영시간 ${p.optString("opensAt")}–${p.optString("closesAt")} · 직접 입력" else "운영시간을 아직 확인하지 않았어요",14))
        content.addView(label("머무를 시간 ${p.optInt("stayMinutes",60)}분${if(p.optBoolean("mustVisit"))" · 코스에 꼭 포함" else ""}",14))
        if(p.optBoolean("demo"))content.addView(label("연동 시험 데이터",13))
        content.addView(softButton("이 장소 삭제"){detail.dismiss();confirmDeletePlace(p)})
        validLocation()?.let{location->content.addView(label("직선 %.1f km · 실제 주행 거리 아님".format(distanceKm(location.latitude,location.longitude,p.getDouble("latitude"),p.getDouble("longitude"))),14,mint))}
        detail=dialog().setTitle(p.getString("name")).setView(ScrollView(this).apply{addView(content)}).setNegativeButton("닫기",null).setNeutralButton("방문 조건"){_,_->showTiming(p)}.setPositiveButton("출발 확인"){_,_->confirmRoute(p)}.create()
        detail.setOnShowListener{detail.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled=naviReady && pending==null}
        detail.show()
    }
    private fun confirmDeletePlace(p:JSONObject){
        if(loading||pending!=null){Toast.makeText(this,"연결 또는 안내 요청이 끝난 뒤 삭제해 주세요",Toast.LENGTH_LONG).show();return}
        val id=p.getString("id");val ballot=room?.optJSONObject("ballot")
        val candidateIds=ballot?.optJSONArray("candidateIds")
        if(ballot?.optString("status")=="open"&&candidateIds!=null&&(0 until candidateIds.length()).any{candidateIds.optString(it)==id}){Toast.makeText(this,"진행 중인 비밀 투표 후보예요. 투표를 마친 뒤 삭제할 수 있어요",Toast.LENGTH_LONG).show();return}
        val stops=room?.optJSONObject("course")?.optJSONArray("stops")
        if(stops!=null&&(0 until stops.length()).any{stops.getJSONObject(it).optString("placeId")==id}){Toast.makeText(this,"저장한 코스에 포함된 장소예요. 다른 코스를 저장한 뒤 삭제하세요",Toast.LENGTH_LONG).show();return}
        val content=column().apply{setPadding(dp(20),dp(10),dp(20),dp(10))}
        content.addView(label("이 추천 장소를 삭제할까요?",20,ink))
        content.addView(label(p.getString("name"),19,ink))
        content.addView(label("목록과 지도에서 숨겨져요. 삭제 직후 되돌리거나, 더보기에서 복원할 수 있어요.",15))
        if(ballot?.optString("status")=="closed"&&candidateIds!=null&&(0 until candidateIds.length()).any{candidateIds.optString(it)==id})content.addView(label("지난 투표 결과에는 장소 이름과 득표가 그대로 남아요.",14))
        if(room?.optString("selectedId")==id)content.addView(label("차량의 최근 선택 기록도 지웁니다. 이미 실행 중인 기본 내비 안내는 유지돼요.",14))
        val confirm=dialog().setView(ScrollView(this).apply{addView(content)}).setNegativeButton("취소",null).setPositiveButton("삭제"){_,_->
            postRoom("places",JSONObject().put("action","delete").put("placeId",id)){
                undoPlaceId=id;undoPlaceName=p.getString("name");undoUntil=android.os.SystemClock.elapsedRealtime()+30000L
                ui.removeCallbacks(expireUndo);ui.postDelayed(expireUndo,30000L);updateUndoBar()
            }
        }.create()
        confirm.show()
    }
    private fun addUndoBar(parent:LinearLayout){
        undoBar=LinearLayout(this).apply{gravity=Gravity.CENTER_VERTICAL;background=surface(soft,13);setPadding(dp(14),dp(6),dp(6),dp(6));visibility=View.GONE}
        parent.addView(undoBar,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(8)})
        updateUndoBar()
    }
    private fun updateUndoBar(){
        val bar=undoBar ?: return
        val visible=safety.allowed&&undoPlaceId.isNotBlank()&&android.os.SystemClock.elapsedRealtime()<undoUntil&&room?.optBoolean("canUndoPlaceDelete")==true
        bar.visibility=if(visible)View.VISIBLE else View.GONE
        bar.removeAllViews()
        if(!visible)return
        bar.addView(label("${undoPlaceName} 삭제됨",14,ink).apply{maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END},LinearLayout.LayoutParams(0,-2,1f))
        val target=undoPlaceId
        bar.addView(softButton("되돌리기"){
            postRoom("places",JSONObject().put("action","restore").put("placeId",target)){
                undoPlaceId="";ui.removeCallbacks(expireUndo);updateUndoBar()
                Toast.makeText(this,"장소를 다시 표시했어요",Toast.LENGTH_SHORT).show()
            }
        },LinearLayout.LayoutParams(dp(96),dp(48)))
    }
    private fun restoreDeletedPlace(){
        dialog().setTitle("최근 삭제 장소를 복원할까요?").setMessage("가장 최근에 삭제한 장소와 기존 투표를 다시 표시합니다. 내비 목적지는 변경하지 않습니다.")
            .setNegativeButton("취소",null).setPositiveButton("복원"){_,_->postRoom("places",JSONObject().put("action","restore")){
                undoPlaceId="";updateUndoBar();Toast.makeText(this,"장소를 다시 표시했어요",Toast.LENGTH_LONG).show()
            }}.show()
    }
    private fun showVoteBeforeDeparture():Boolean{
        if(room?.optJSONObject("ballot")?.optString("status")!="open")return false
        val content=column().apply{setPadding(dp(20),dp(14),dp(20),dp(10))}
        content.addView(label("아직 비밀투표가 진행 중이에요",20,ink))
        content.addView(label("일행의 투표를 마감한 뒤 목적지를 선택할 수 있어요. 지금은 내비로 보내지 않았어요.",16))
        dialog().setView(content).setNegativeButton("돌아가기",null).setPositiveButton("투표 화면 열기"){_,_->goToTab("ballot")}.show()
        return true
    }
    private fun confirmRoute(p: JSONObject) {
        if(showVoteBeforeDeparture())return
        dialog().setTitle("이 장소로 안내할까요?")
            .setMessage("${p.getString("name")}\n${p.optString("address")}\n\n기본 내비의 현재 목적지를 이 장소로 변경합니다.")
            .setNegativeButton("돌아가기",null).setPositiveButton("내비로 보내기") { _,_ -> sendRoute(p) }.show()
    }
    private fun sendRoute(p: JSONObject) {
        if(!canInteract())return
        if(showVoteBeforeDeparture())return
        if (!naviReady || pending != null) return
        pending = p
        pendingWaypoints=emptyList();destinationConfirmed=false;waypointsConfirmed=true;waypointNamesOnly=false
        try {
            navi!!.requestRoute(RouteInfo(latitude=p.getDouble("latitude"),longitude=p.getDouble("longitude"),poiName=p.getString("name"),address=p.optString("address"),displayLatitude=null,displayLongitude=null,poiId="",poiSubId=""))
            navigationStatus = "목적지 전달 요청됨 · 내비의 확인 응답 대기"
            Log.i("Moagil", "Route requested")
            ui.postDelayed(routeTimeout,30000)
            // Show any native route confirmation/error UI while waiting for a callback.
            openNavigation()
            ui.postDelayed(checkDestination,1800)
        } catch(e: Exception) { pending = null; navigationStatus = "목적지 전달 실패: ${e.message}" }
        refreshStatus(); renderCards()
    }
    private fun acknowledge(destination: DestinationInfo) {
        val p = pending ?: return
        if (destination.name != p.getString("name") || abs(destination.latitude-p.getDouble("latitude"))>0.001 || abs(destination.longitude-p.getDouble("longitude"))>0.001) return
        destinationConfirmed=true
        if(pendingWaypoints.isNotEmpty())runCatching{navi?.getWaypointInfo()}
        finishAcknowledgement()
    }
    private fun confirmCourseRoute(course:JSONObject){
        if(showVoteBeforeDeparture())return
        val stops=course.getJSONArray("stops");val index=course.optInt("nextIndex")
        val route=(index until minOf(index+3,stops.length())).map{JSONObject(stops.getJSONObject(it).toString()).apply{put("id",getString("placeId"))}}
        if(route.isEmpty())return
        val content=column().apply{setPadding(dp(20),dp(10),dp(20),dp(10))}
        content.addView(label("방문 순서대로 내비에 보낼까요?",20,ink))
        route.forEachIndexed{i,p->content.addView(label("${i+1}. ${p.getString("name")}",18,ink))}
        content.addView(label("기본 내비의 기존 목적지와 경유지를 변경해요. 최대 3곳씩 보내며 방문 완료는 앱에서 표시해 주세요.",14))
        content.addView(label("카카오 계산과 플레오스 안내 경로·시간은 다를 수 있어요.",13))
        dialog().setView(ScrollView(this).apply{addView(content)}).setNegativeButton("돌아가기",null).setPositiveButton("코스 보내기"){_,_->sendCourseRoute(route)}.show()
    }
    private fun sendCourseRoute(route:List<JSONObject>){
        if(!canInteract())return
        if(showVoteBeforeDeparture())return
        if(!naviReady || pending!=null)return
        if(route.size==1){sendRoute(route[0]);return}
        pending=route.last();pendingWaypoints=route.dropLast(1);destinationConfirmed=false;waypointsConfirmed=false;waypointNamesOnly=false
        try{
            val p=route.last()
            val destination=RouteInfo(latitude=p.getDouble("latitude"),longitude=p.getDouble("longitude"),poiName=p.getString("name"),address=p.optString("address"),displayLatitude=null,displayLongitude=null,poiId="",poiSubId="")
            val waypoints=pendingWaypoints.mapIndexed{i,s->RequestWaypointInfo(latitude=s.getDouble("latitude"),longitude=s.getDouble("longitude"),poiName=s.getString("name"),waypointIndex=if(i==0)WaypointIndex.FIRST else WaypointIndex.SECOND,poiId="",address=s.optString("address"),poiSubId="")}
            navi!!.requestRouteWithWaypoints(RouteWithWaypointsRequest(destination,waypoints))
            navigationStatus="코스 전달 요청됨 · 목적지와 경유지 확인 응답 대기"
            Log.i("Moagil","Course route requested: ${route.size} stops")
            ui.postDelayed(routeTimeout,30000);openNavigation();ui.postDelayed(checkDestination,1800)
        }catch(e:Exception){pending=null;pendingWaypoints=emptyList();navigationStatus="코스 전달 실패: ${e.message}"}
        refreshStatus();renderCards()
    }
    private fun finishAcknowledgement(){
        val p=pending ?: return
        if(!destinationConfirmed || (!waypointsConfirmed&&!waypointNamesOnly))return
        val courseRequest=pendingWaypoints.isNotEmpty()
        pending = null; ui.removeCallbacks(routeTimeout); ui.removeCallbacks(checkDestination)
        pendingWaypoints=emptyList()
        navigationStatus = if(courseRequest&&waypointNamesOnly&&!waypointsConfirmed)"목적지·경유지 이름/순서 확인 · 경유지 좌표는 내비가 제공하지 않아 화면에서 확인해 주세요" else if(courseRequest)"기본 내비에서 목적지와 경유지 순서를 확인했습니다" else "기본 내비에서 목적지를 확인했습니다"
        Log.i("Moagil",if(courseRequest&&waypointNamesOnly&&!waypointsConfirmed)"Course names confirmed; waypoint coordinates unavailable" else if(courseRequest)"Course acknowledged with waypoints" else "Destination acknowledged")
        refreshStatus(); renderCards()
        io.execute { runCatching { request("/api/rooms/$roomId/select",JSONObject().put("placeId",p.getString("id"))) }.onFailure { ui.post { navigationStatus="내비 확인됨 · 여행방 동기화 실패"; refreshStatus() } } }
    }
    private fun waypointCoordinatesMatch(actual:WaypointInfo,expected:JSONObject):Boolean{
        val lat=expected.getDouble("latitude");val lon=expected.getDouble("longitude")
        return (abs(actual.latitude-lat)<=0.001&&abs(actual.longitude-lon)<=0.001) ||
            (actual.displayLatitude?.let{abs(it-lat)<=0.001}==true&&actual.displayLongitude?.let{abs(it-lon)<=0.001}==true)
    }
    private fun openNavigation() {
        if (!naviReady) { navigationStatus="기본 내비 연결을 기다려주세요"; refreshStatus(); return }
        runCatching { navi?.requestNavigationScreen(NavigationScreenRequest.Foreground) }.onFailure { navigationStatus="내비 화면 요청 실패: ${it.message}"; refreshStatus() }
    }
    private fun inviteUrl() = "$publicUrl/#room=$roomId&token=$joinToken"
    private fun showInvite() {
        if(!canInteract())return
        if(localOnly){
            val info=column().apply{setPadding(dp(20),dp(10),dp(20),dp(10))}
            info.addView(label("휴대폰 연결 준비가 필요해요",20,ink))
            info.addView(label("초대 연결을 준비하고 있어요. 연결이 준비되면 QR로 일행을 초대할 수 있어요.",16))
            dialog().setView(info).setPositiveButton("확인",null).show();return
        }
        if (roomId.isBlank()) { Toast.makeText(this,"모임을 불러온 뒤 다시 열어주세요",Toast.LENGTH_LONG).show(); return }
        val content = column().apply { setPadding(dp(24),dp(12),dp(24),dp(12)) }
        content.addView(label("휴대폰 카메라로 QR을 스캔해 주세요.",16))
        val matrix = MultiFormatWriter().encode(inviteUrl(),BarcodeFormat.QR_CODE,480,480)
        val bitmap = Bitmap.createBitmap(480,480,Bitmap.Config.ARGB_8888)
        for(y in 0 until 480) for(x in 0 until 480) bitmap.setPixel(x,y,if(matrix[x,y])Color.BLACK else Color.WHITE)
        content.addView(ImageView(this).apply { setImageBitmap(bitmap); contentDescription="여행방 참여 QR" },LinearLayout.LayoutParams(dp(250),dp(250)).apply { gravity=Gravity.CENTER_HORIZONTAL })
        content.addView(label("초대 링크를 가진 일행이 장소를 보고 추가할 수 있습니다.",12))
        content.addView(label(inviteUrl(),11).apply { setTextIsSelectable(true) })
        dialog().setTitle("일행 초대 QR").setView(ScrollView(this).apply{addView(content)}).setPositiveButton("닫기",null).show()
    }
    private fun showSettings() {
        val layout=column().apply{setPadding(dp(22),dp(10),dp(22),dp(10))}
        layout.addView(label("에뮬레이터의 PC 공유 서버 주소",16))
        val input=textInput(baseUrl()).apply{inputType=android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI}
        layout.addView(input)
        layout.addView(softButton("음성 연동 상태"){showGleoGuide()})
        layout.addView(label("기본값: http://10.0.2.2:8787\n스마트폰 QR 주소는 PC 서버의 PUBLIC_URL에서 설정합니다. PC와 휴대폰 간 접속 가능한 네트워크가 필요합니다.\n서버를 바꾸면 새 여행방을 만듭니다.",14))
        dialog().setTitle("여행방 연결 설정").setView(layout).setNegativeButton("닫기",null).setPositiveButton("저장") { _,_ ->
            val value=input.text.toString().trim().trimEnd('/')
            val uri=runCatching { URI(value) }.getOrNull()
            if (uri?.host == null || uri.scheme !in listOf("http","https") || uri.userInfo!=null || !uri.rawPath.isNullOrEmpty() || uri.query!=null || uri.fragment!=null) { Toast.makeText(this,"서버의 http 또는 https 주소를 입력하세요",Toast.LENGTH_LONG).show(); return@setPositiveButton }
            if (value != baseUrl() && !loading && pending==null) {
                prefs.edit().putString("serverUrl",value).remove("roomId").remove("ownerToken").remove("joinToken").remove("cachedRoom").apply()
                roomId="";ownerToken="";joinToken="";room=null;revision=-1;connected=false;refreshStatus();renderCards();sync()
            }
        }.show()
    }
    private fun distanceKm(a:Double,b:Double,c:Double,d:Double):Double {
        val lat=Math.toRadians(c-a);val lon=Math.toRadians(d-b)
        val h=sin(lat/2)*sin(lat/2)+cos(Math.toRadians(a))*cos(Math.toRadians(c))*sin(lon/2)*sin(lon/2)
        return 6371*2*atan2(sqrt(h.coerceIn(0.0,1.0)),sqrt((1-h).coerceIn(0.0,1.0)))
    }
    private fun column()=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL}
    // The Pleos wide display reports 160dpi; use generous physical targets and readable car text.
    private fun dp(n:Int)=(n*resources.displayMetrics.density*2f).toInt()
    private fun label(value:String,size:Int,color:Int=muted)=TextView(this).apply{
        text=value;textSize=size*2f;setTextColor(color);includeFontPadding=false;gravity=Gravity.START or Gravity.CENTER_VERTICAL
        typeface=Typeface.create("sans-serif",Typeface.NORMAL);setLineSpacing(0f,1.14f);setPadding(0,dp(4),0,dp(4))
    }
    private fun button(value:String,action:()->Unit)=Button(this).apply{
        text=value;textSize=if(slimScreen)26f else 28f;isAllCaps=false;includeFontPadding=false;gravity=Gravity.CENTER
        typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);minHeight=dp(48);minimumHeight=dp(48);minWidth=0;minimumWidth=0
        setTextColor(MoagilBrand.onAccent);background=surface(mint,13);setPadding(dp(12),dp(8),dp(12),dp(8))
        stateListAnimator=null;elevation=0f;translationZ=0f;maxLines=2;ellipsize=android.text.TextUtils.TruncateAt.END
        layoutParams=LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(6);bottomMargin=dp(2)}
        setOnClickListener{if(canInteract())action()}
    }
    override fun onResume(){super.onResume();active=true;safety.start();ui.removeCallbacks(tick);ui.post(tick);if(naviReady)runCatching{navi?.getCurrentLocationInfo()}}
    override fun onPause(){active=false;resultSheet?.dismiss();ui.removeCallbacks(tick);super.onPause()}
    @Deprecated("Legacy back callback") override fun onBackPressed(){moveTaskToBack(true)}
    override fun onDestroy(){dismissSheets();safety.stop();ui.removeCallbacksAndMessages(null);runCatching{navi?.removeListener(listener)};navi?.release();io.shutdownNow();super.onDestroy()}
}














