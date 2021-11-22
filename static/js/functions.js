let rx = 0.00080, ry = 0.00110;
let defaultCenter = [40.6649226, 14.799387];
let defaultZoom = 13.6;
let EARTH_RADIUS = 6371;
let tavolaColori = [["#9E0142",5], ["#D13C4B",10], ["#F0704A",15], ["#FCAC63",20], ["#FEDD8D",25], ["#A9DDA2",30], ["#69BDA9",35], ["#4EA4B0",40], ["#4288B5",45], ["#4A6CAE",50], ["#5E4FA2",55]];
let iconHospital = L.divIcon({html: '<i id="icona1" class="fas fa-hospital-symbol" style="font-size:18px;color:red;position:relative;left:-5px;top:-5px"></i>', iconSize: [10,10]});
let iconParking = L.divIcon({html: '<i class="fas fa-parking" style="font-size:18px;color:blue;position:relative;left:-4px;top:-4px"></i>', iconSize: [10,10]});
let iconShopping = L.divIcon({html: '<i class="fas fa-shopping-cart" style="font-size:15px;color:green"></i>', iconSize: [15,15]});
let iconPin = L.icon({iconUrl: 'img/pin.png', iconSize: [24, 24], iconAnchor: [12, 23]});
let icons = {'hospital': iconHospital, 'parking': iconParking, 'shopping': iconShopping};
var mymap;
var centers = [];
var markers = [];
var tooltips = [];
var polyGroup = [];
var hexOnMap = [];
var centralHexagons = [];
var centralArea;
var centri;
var pointPopup;
var destination = {};
var env;
var osmTiles;
var osmOptions;
var planningType;
var destinationMarker;
//
function hexagon(pos_x,pos_y){       //funzione per costruire gli esagoni
    var poly = [
        [ pos_x[0], pos_y[0] ],
        [ pos_x[1], pos_y[1] ],
        [ pos_x[2], pos_y[2] ],
        [ pos_x[3], pos_y[3] ],
        [ pos_x[4], pos_y[4] ],
        [ pos_x[5], pos_y[5] ]
    ];
    return poly;
}

function Polyline(path){
    new_path = [];
    for(i=0;i<path.length;i++){
        new_path.push([path[i][1],path[i][0]]);
    }
    return new_path;
}

function getDistance(origin, destination) {
// ritorna la distanza in metri
    let lon1 = toRadian(origin[1]);
    let lat1 = toRadian(origin[0]);
    let lon2 = toRadian(destination[1]);
    let lat2 = toRadian(destination[0]);
    let deltaLat = lat2 - lat1;
    let deltaLon = lon2 - lon1;
    let a = Math.pow(Math.sin(deltaLat/2), 2) + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(deltaLon/2), 2);
    let c = 2 * Math.asin(Math.sqrt(a));
    return c * EARTH_RADIUS * 1000;
}

function toRadian(degree) {
    return degree*Math.PI/180;
}

function time(secondiTotali){
    var minuti = Math.floor(secondiTotali/60);
    var secondi = secondiTotali - minuti*60;
    return(minuti+" min e "+secondi+" s");
}

function space(metriTotali){
    if(metriTotali>=1000) {
        km = Math.floor(metriTotali/1000);
        metri = metriTotali - km*1000;
        return(km+" Km e "+metri+" m");
    }
    else return(metriTotali+" m");
}

function hexagonsOnMap(centers){
    for(j=0; j<centers.length;j++){
        pos_x = [];
        pos_y = [];
        for(i=0;i<6;i++){
            pos_x[i] =  centers[j].lat + rx*Math.sin(i*Math.PI/3);
            pos_y[i] =  centers[j].lng + ry*Math.cos(i*Math.PI/3);
        }
        hex = hexagon(pos_x, pos_y);
        poly = L.polygon(hex,{opacity:0, fillOpacity:0},).addTo(mymap);
        if (centers[j].central){
            poly.on('click', function(event){hexClick(event)});
        } else {
            poly.on('click', function(){showPoint(this)});
        }
        hexOnMap.push({"id": centers[j].id, "central": centers[j].central, "esagono": poly});
    }
    lastEsagono = hexOnMap[0].esagono;
    paintCentralPoints();
}

function getPoints(){
    $.ajax({
        type: "GET",
        url: "points",
        async: true,
        success: function(result){
            hexagonsOnMap(result);
        }
    });
}

function cleanHex(){
    for (i=0;i<hexOnMap.length;i++){
        if (!hexOnMap[i].central)
            mymap.removeLayer(hexOnMap[i].esagono);
    }
}

function hexClick(event){
        destination = event.latlng;
        destinationMarker.setLatLng(destination)
        destinationMarker.setOpacity(1);
        lastEsagono._path.style.strokeOpacity = 0;
        getNonCentralPoints();
}

function getNonCentralPoints(){
        $.ajax({
            type: "GET",
            url: "accessibility",
            data: {type: planningType, lat: destination.lat, lng: destination.lng},
            async: true,
            success: function(result){
                if(result.length>1){
                    paintNotCentral(result);
                }
            }
        });
}

function paintNotCentral(values){
    colore = tavolaColori[tavolaColori.length-1][0];
    for(i=0;i<values.length;i++){
        durata = values[i].driving + values[i].parking + values[i].walking;
        for(z=0;z<tavolaColori.length;z++){
            if(durata < tavolaColori[z][1]){
                colore = tavolaColori[z][0];
                break;
            }
        }
        j = values[i].point - 1;
        hexOnMap[j].esagono.setStyle({color:colore, fillOpacity: 0.5, value:values[i]}).addTo(mymap);
    }
}

function paintCentralPoints(){
    for (i=0; i<hexOnMap.length; i++){
        if (hexOnMap[i].central){
            hexOnMap[i].esagono.setStyle({color: '#b0b0b0', opacity: 0, fillOpacity: 0.5});
        }
    }
}

function showPoint(esagono){
    if (esagono.options.value){
            value = esagono.options.value;
            driving = "<tr><td>Guida diretta: </td><td>" + time(value.driving) + "</td></tr>";
            parking = "<tr><td>Ricerca parcheggio: </td><td>" + time(value.parking) + "</td></tr>";
            walking = "<tr><td>A piedi: </td><td>" + time(value.walking) + "</td></tr>";
            if (planningType == 'appdiff') labelTotal = "Beneficio totale:        ";
            else labelTotal = "Tempo totale: "
            total = "<tr><td><b>" + labelTotal + "</b></td><td><b>" + time(value.driving + value.parking + value.walking) + "</b></td></tr>";
            lastEsagono._path.style.strokeOpacity = 0;
            lastEsagono = esagono;
            esagono._path.style.stroke = "#9E0142";
            esagono._path.style.strokeOpacity = 1;
            esagono.bindPopup("<table>" + total + driving + parking + walking + "</table>").openPopup();
    }
}

function getPois(tipo){
    $.ajax({
        type: "GET",
        url: "pois",
        data: {type: tipo},
        async: true,
        success: function(result){
            showMarkers(result, tipo);
            console.log(result);
        }
    })
}

function showMarkers(pois, tipo){
    icon = icons[tipo];
    for(i=0;i<pois.length;i++){
        var marker = L.marker([pois[i].lat, pois[i].lng],{icon:icon, id: pois[i].id}).addTo(mymap);
        var tooltip = marker.bindTooltip(pois[i].name,{permanent:true, className:'tooltipPOI', direction:'top'}).openTooltip();
        tooltips.push(tooltip);
        markers.push(marker);
    }
}

function setPlanningType(ptype){
    planningType = ptype;
    $("#" + ptype).css("border", "2px solid black" );
    if (!$.isEmptyObject(destination)){
        getNonCentralPoints();
    }
}

function creaTavolaColori(){
    var txt = '';
    var range = tavolaColori[1][1]-tavolaColori[0][1];
    txt += '<div class="legendColor"><div class="colorSpan" style="background:'+ tavolaColori[0][0] +'"></div><span class="livelliTempo"> < '+tavolaColori[0][1]+'</span></div>';
    for(i=1;i<(tavolaColori.length - 1);i++){
        txt += '<div class="legendColor"><div class="colorSpan" style="background:'+ tavolaColori[i][0] +'"></div><span class="livelliTempo">'+tavolaColori[i-1][1]+" - "+tavolaColori[i][1]+'</span></div> ';
    }
    txt += '<div class="legendColor"><span class="colorSpan" style="background:'+ tavolaColori[i][0] +'"></span><span class="livelliTempo"> > '+(tavolaColori[i-1][1] + range)+'</span></div>';
    document.getElementById("tavolaColori").innerHTML = txt;
    for(i=0;i<tavolaColori.length;i++){
        tavolaColori[i][1] *= 60;
    }
}

function getEnv(){
    $.ajax({
        type: "GET",
        url: "env",
        async: false,
        success: function(result){
            env = result;
        }
    });
}

function initialize(){
    getEnv();
    osmtiles = env['osmtiles'];
    osmoptions = JSON.parse(env['osmoptions']);
    mymap = L.map('mapid', {zoomControl:false, zoomSnap: 0.10, zoomDelta:0.10}).setView(defaultCenter, defaultZoom);
    L.tileLayer(osmtiles, osmoptions).addTo(mymap);
    L.control.scale().addTo(mymap);
    L.Control.zoomHome({position:'bottomright'}).addTo(mymap);
    destinationMarker = L.marker(defaultCenter, {icon: iconPin, opacity: 0}).addTo(mymap);
    if(window.ipcRenderer){
        renderer = window.ipcRenderer;
        map.on('zoomend', function(){
            try{
                renderer.send("zoom", map.getZoom());
            } catch(e){
                console.log("renderer.send zoom non funziona");
            }
        });
        map.on('moveend', function(){
            try{
                renderer.send("center", map.getCenter());
            } catch(e){
                console.log("renderer.send center non funziona");
            }
        });
        renderer.on("fromMain", function(data){
            map.setView(data.center, data.zoom);
        });
    } else {
        console.log("Qui Maps, no IpcRenderer")
    };
    creaTavolaColori();
    getPoints();
    getPois('parking');
    $("#closeLegenda").click(function(){
        $("#pannelloLegenda").hide();
        $("#closeLegenda").hide();
        $("#openLegenda").show();
    });
    $("#openLegenda").click(function(){
        $("#pannelloLegenda").show();
        $("#closeLegenda").show();
        $("#openLegenda").hide();
    });
    $("#closeOrari").click(function(){
        $("#pannelloOrari").hide();
        $("#closeOrari").hide();
        $("#openOrari").show();
    });
    $("#openOrari").click(function(){
        $("#pannelloOrari").show();
        $("#closeOrari").show();
        $("#openOrari").hide();
    });
     $("#closePlanning").click(function(){
        $("#pannelloPlanning").hide();
        $("#closePlanning").hide();
        $("#openPlanning").show();
    });
    $("#openPlanning").click(function(){
        $("#pannelloPlanning").show();
        $("#closePlanning").show();
        $("#openPlanning").hide();
    });
    $("#closeCity").click(function(){
        $("#pannelloCity").hide();
        $("#closeCity").hide();
        $("#openCity").show();
    });
    $("#openCity").click(function(){
        $("#pannelloCity").show();
        $("#closeCity").show();
        $("#openCity").hide();
    });
    $(".btn-planning").click(function(){
        $(".btn-planning").css("border", "none");
        setPlanningType(this.id);
    });
    setPlanningType("noapp");

 };

$(function(){
    initialize();
});