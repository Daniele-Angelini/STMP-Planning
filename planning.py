import asyncio
import json
import logging
import os
import selectors
import time

import psycopg2
import requests
import tornado.ioloop
import tornado.web

#from dotenv import load_dotenv

dbplanning = "dbname='planning' host='cloud.nergal.it' user='planning' password='*********'"
osmtiles = "https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}"
osmoptions = json.dumps({
    'attribution': 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
    'maxZoom': 20,
    'id': 'mapbox/streets-v11',
    'accessToken': 'pk.eyJ1IjoiZGFuaWVsZWFuZ2VsaW5pIiwiYSI6ImNrNmkwOWg1bTAxdDczbW16M2F2OXlsbWEifQ.V8Sn6Ifwy9Z5jIBR4YI7yA'
})

def prepare_data():
    conn = None
    distances = []
    try:
        start_time = time.time()
        conn = psycopg2.connect(dbplanning)
        cursor = conn.cursor()
        sql = "select id from points where central is false;"
        cursor.execute(sql)
        points = cursor.fetchall()
        sql = "select id from pois where type = 'parking' order by id;"
        cursor.execute(sql)
        parks = cursor.fetchall();
        to_park = {}
        sql = "select origin, destination, time from tratte,points,pois where origin=points.id and" \
              " destination=pois.id and pois.type='parking' and mode='driving' and central is false" \
              " order by origin, destination;"
        cursor.execute(sql)
        lines = cursor.fetchall()
        print("Step 1: " + str(time.time() - start_time))
        for line in lines:
            if line[0] not in to_park:
                to_park[line[0]] = {}
            to_park[line[0]][line[1]] = line[2]
        print("Step 2: " + str(time.time() - start_time))
        sql = "select id, lat, lng from pois where type='parking' order by id"
        cursor.execute(sql)
        lines = cursor.fetchall()
        coordinates = {}
        for line in lines:
            coordinates[line[0]] = {"lat": line[1], "lng": line[2]}
        sql = "select id_parking_iniziale, id_parking_finale, time, peso from data_support where type='NoApp' " \
              "order by id_parking_iniziale, id_parking_finale;"
        cursor.execute(sql)
        lines = cursor.fetchall()
        ricerche = {}
        for line in lines:
            if line[0] not in ricerche:
                ricerche[line[0]] = {}
            ricerche[line[0]][line[1]] = {'time': line[2], 'peso': line[3]}
        for i in ricerche:
            peso = 0
            for j in ricerche[i]:
                peso += ricerche[i][j]['peso']
            for j in ricerche[i]:
                ricerche[i][j]['peso'] /= peso
        print("Step 3: " + str(time.time() - start_time))
    except (Exception, psycopg2.DatabaseError) as error:
        print(error)
    finally:
        if conn is not None:
            conn.close()
    return to_park, coordinates, ricerche


"""
Gestione funzioni web con Tornado
"""


class BaseHandler(tornado.web.RequestHandler):
    def set_default_headers(self):
        def options(self):
            # no body
            self.set_status(204)
            self.finish()


class GetEnv(BaseHandler):
    def get(self):
        env = {}
        try:
            env['osmtiles'] = osmtiles
            env['osmoptions'] = osmoptions
        except Exception as error:
            print(error)
        self.set_header('Content-Type', 'text/json')
        self.write(env)


class GetPoints(BaseHandler):
    def get(self):
        conn = None
        points = []
        try:
            conn = psycopg2.connect(dbplanning)
            cursor = conn.cursor()
            sql = "select id, lat, lng, central from points order by id;"
            cursor.execute(sql)
            lines = cursor.fetchall()
            for line in lines:
                points.append({"id": line[0], "lat": line[1], "lng": line[2], "central": line[3]})
        except (Exception, psycopg2.DatabaseError) as error:
            print(error)
        finally:
            if conn is not None:
                conn.close()
        print("Trovati " + str(len(points)) + " punti")
        result = json.dumps(points)
        self.set_header('Content-Type', 'text/json')
        self.write(result)


class GetPois(BaseHandler):
    def get(self):
        tipo = self.get_argument('type')
        conn = None
        pois = []
        try:
            conn = psycopg2.connect(dbplanning)
            cursor = conn.cursor()
            sql = "select id, lat, lng, name from pois where type=%s order by id;"
            cursor.execute(sql, (tipo,))
            lines = cursor.fetchall()
            for line in lines:
                pois.append({"id": line[0], "lat": line[1], "lng": line[2], "name": line[3]})
        except (Exception, psycopg2.DatabaseError) as error:
            print(error)
        finally:
            if conn is not None:
                conn.close()
        print("Trovati " + str(len(pois)) + " poi")
        result = json.dumps(pois)
        self.set_header('Content-Type', 'text/json')
        self.write(result)


def appParking(nearest_parking):
    try:
        conn = psycopg2.connect(dbplanning)
        cursor = conn.cursor()
        # correzione provvisoria perchè nel db manca il valore 25
        if nearest_parking == 25:
            nearest_parking = 26
        #
        sql = "select id_esagono, id_parking_finale, count(*) from  data_support, points where type='App'" \
              " and id_parking_iniziale=%s and id_esagono=points.id and not points.central " \
              "group by id_esagono,id_parking_finale order by id_esagono, id_parking_finale;"
        cursor.execute(sql, (nearest_parking,))
        lines = cursor.fetchall()
        parkings_with_app = {}
        for line in lines:
            if line[0] not in parkings_with_app:
                parkings_with_app[line[0]] = {}
            parkings_with_app[line[0]][line[1]] = {'peso': line[2]}
        for point in parkings_with_app:
            peso = 0
            for park in parkings_with_app[point]:
                peso += parkings_with_app[point][park]['peso']
            for park in parkings_with_app[point]:
                parkings_with_app[point][park]['peso'] /= peso
    except Exception as error:
        logging.exception("errore in appParking")
    finally:
        if conn is not None:
            conn.close()
    return parkings_with_app


class GetAccessibility(BaseHandler):
    def get(self):
        timings = []
        try:
            lat = self.get_argument('lat')
            lng = self.get_argument('lng')
            final_destination = {'lat': float(lat), 'lng': float(lng)}
            tipo = self.get_argument('type')
            # identifichiamo i parcheggi
            parks = {}
            for park in parking_coordinates:
                stringRequest = "https://maps.googleapis.com/maps/api/directions/json?origin=" + \
                                str(parking_coordinates[park]['lat']) + "," + str(parking_coordinates[park]['lng']) + \
                                "&destination=" + lat + "," + lng + "&mode=walking&language=it&key=AIzaSyBHyCHBUaFlzF5326HlCM8ZHEQWDEsM2xM"
                response = requests.get(stringRequest)
                path = response.json()
                duration = path['routes'][0]['legs'][0]['duration']['value']
                parks[park] = duration;
            nearest_parking = min(parks, key=parks.get)
            timings = []
            if tipo == 'noapp':
                park_times = parking_ricerca[nearest_parking]
                parking_time = int(sum(park_times[i]['peso'] * park_times[i]['time'] for i in park_times))
                walking_time = int(sum(park_times[i]['peso'] * parks[i] for i in park_times))
                for point in to_park:
                    timing = {'point': point, 'driving': int(to_park[point][nearest_parking]), 'parking': parking_time,
                              'walking': walking_time}
                    timings.append(timing)
            elif tipo == 'withapp':
                parkings_with_app = appParking(nearest_parking)
                for point in parkings_with_app:
                    timing = {'point': point}
                    timing['driving'] = int(sum(parkings_with_app[point][park]['peso'] * to_park[point][park] for park in
                                            parkings_with_app[point]))
                    timing['parking'] = 0.
                    timing['walking'] = int(sum(
                        parkings_with_app[point][park]['peso'] * parks[park] for park in parkings_with_app[point]))
                    timings.append(timing)
            elif tipo == 'appdiff':
                parkings_with_app = appParking(nearest_parking)
                park_times = parking_ricerca[nearest_parking]
                noapp_parking_time = sum(park_times[i]['peso'] * park_times[i]['time'] for i in park_times)
                noapp_walking_time = sum(park_times[i]['peso'] * parks[i] for i in park_times)
                for point in to_park:
                    timing = {'point': point}
                    timing['driving'] = int(to_park[point][nearest_parking] - sum(parkings_with_app[point][park]['peso']
                                                                              * to_park[point][park] for park in
                                                                              parkings_with_app[point]))
                    timing['parking'] = int(noapp_parking_time)
                    timing['walking'] = int(noapp_walking_time - sum(
                        parkings_with_app[point][park]['peso'] * parks[park] for park in parkings_with_app[point]))
                    timings.append(timing)
            else:
                pass
        except Exception as error:
            logging.exception("errore in accessibility")
        finally:
            pass
        print("Trovati " + str(len(timings)) + " timings")
        result = json.dumps(timings)
        self.set_header('Content-Type', 'text/json')
        self.write(result)


def make_app():
    return tornado.web.Application([
        (r"/points", GetPoints),
        (r"/pois", GetPois),
        (r"/accessibility", GetAccessibility),
        (r"/env", GetEnv),
        (r"/(.*)", tornado.web.StaticFileHandler, {"path": './static', "default_filename": "index.html"}),
        (r'/js/(.*)', tornado.web.StaticFileHandler, {'path': './static/js'}),
        (r'/css/(.*)', tornado.web.StaticFileHandler, {'path': './static/css'})
    ])


to_park, parking_coordinates, parking_ricerca = prepare_data()

if __name__ == "__main__":
    #asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    selector = selectors.SelectSelector()
    loop = asyncio.SelectorEventLoop(selector)
    app = make_app()
    app.listen(60003)
    DBPOSTGRES = os.getenv("DBPOSTGRES")
    if DBPOSTGRES is not None:
        dbplanning = DBPOSTGRES
    OSMTILES = os.getenv("OSMTILES")
    if OSMTILES is not None:
        osmtiles = OSMTILES
    OSMOPTIONS = os.getenv("OSMOPTIONS")
    if OSMOPTIONS is not None:
        osmoptions = OSMOPTIONS
    print("Planning started!")
    tornado.ioloop.IOLoop.current().start()
